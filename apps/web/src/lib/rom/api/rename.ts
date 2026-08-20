// Sequential `await` in a loop is this module's normal shape: it is ORDERED
// filesystem work (measure, then delete, then re-create) over a handful of
// folders, and running the deletes concurrently would race each folder's
// re-create against the walk of the next.
/* oxlint-disable no-await-in-loop */
import { exists, mkdir, readDir, remove, stat } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import { basename, charScopeInput, joinPath } from './core'
import { characterExportRoot } from '#/lib/scene-subfolder.ts'
import { characterSlug, exporterFigureName } from '@dth/rom'
import { exportWipeTargets, hasExportFiles, movedFrom } from '../rename-exports.ts'
import { houdiniUtilsReady, repairHoudiniDefaults, retargetHoudiniReferences } from './houdini-material'
import { loadCharacter } from './execute/primitives'
import { normalizeRelFolder } from '../library'
import { relativeInside } from '../storage/fs'

import type { Character } from '@dth/rom'
import type { ExportWipeMeasure } from '../rename-exports.ts'

// Renaming a character — the half that is not just writing a new name.
//
// The definition, the folder and the generated Daz scripts are `saveCharacter`
// + `generateCharacterFiles`' business (the rename rides `previousName` through
// both). What is left is everything the OLD name is baked into that neither of
// them touches: the export sets already on disk, which no future run will ever
// write to again, and the Houdini projects still importing them by name. See
// `../rename-exports.ts` for why those files are cleared rather than renamed.

/** How many entries a measuring walk visits before it stops counting. The
 *  dialog has to open in well under a second, and a bone-scale export folder
 *  can hold a reference skeleton per FRAME — long past the point where an exact
 *  count tells the user anything a "1.2 GB" does not. */
const MEASURE_ENTRY_CAP = 20_000

/** What a rename is about to cost — read before it happens, because that is
 *  when the old name's files are still where the dialog can name them. */
export interface CharacterRenameImpact {
  /** The character's folder as it stands NOW. Handed back to
   *  {@link applyCharacterRenameCleanup} afterwards so the Houdini retarget can
   *  swap an exact old prefix instead of re-deriving one from two names (a
   *  hand-renamed folder, or a `uniqueFolder` fork to "Nova (2)", makes that
   *  derivation wrong in the one way that matters). */
  folderAbs: string
  /** The two export trees, measured — empty ones included, so the dialog can
   *  say "the Houdini export folder is already empty" rather than omit it. */
  targets: Array<ExportWipeMeasure>
  /** At least one of them holds a file: the dialog's whole trigger. */
  wipes: boolean
  /** Linked `.hip` projects the rename will be followed into. */
  houdiniProjects: Array<string>
  /** Why the Houdini half cannot run (no paired Houdini install), or ''. Told
   *  BEFORE the rename rather than warned about after: clearing the exports
   *  cannot be undone, and a user whose projects can't be repointed may well
   *  want to fix Settings first. */
  houdiniBlocked: string
}

/** Recursively count files + bytes under `dir`, bounded by
 *  {@link MEASURE_ENTRY_CAP}. Tolerant: an unreadable subfolder contributes
 *  nothing rather than failing the dialog — the delete that follows is
 *  best-effort too, and a number is not worth a blocked rename. */
async function measureFolder(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0
  let bytes = 0
  let visited = 0
  const walk = async (folder: string): Promise<void> => {
    if (visited >= MEASURE_ENTRY_CAP) return
    let entries: Awaited<ReturnType<typeof readDir>>
    try {
      entries = await readDir(folder)
    } catch {
      return
    }
    for (const entry of entries) {
      if (visited >= MEASURE_ENTRY_CAP) return
      visited += 1
      const path = joinPath(folder, entry.name)
      if (entry.isDirectory) {
        await walk(path)
        continue
      }
      files += 1
      try {
        bytes += (await stat(path)).size
      } catch {
        // a file we can't stat still COUNTS as a file — its size is unknown,
        // never zero-by-assumption
      }
    }
  }
  if (await exists(dir)) await walk(dir)
  return { files, bytes }
}

/** The two export trees of a character, measured. Shared by the impact read and
 *  the cleanup so they can never disagree about what "the export files" are. */
async function measureExportTrees(
  projectId: string,
  id: string,
): Promise<{
  character: Character
  folderAbs: string
  targets: Array<ExportWipeMeasure>
  houdiniProjects: Array<string>
}> {
  const { project, location, character } = await loadCharacter(projectId, id)
  const targets: Array<ExportWipeMeasure> = []
  for (const target of exportWipeTargets({
    charFolderAbs: location.folderAbs,
    derivedExportRoot: characterExportRoot(location.folderAbs, project.houdiniSubdir),
    storedExportRoot: character.exportPath,
    finalExportDir: joinPath(location.folderAbs, normalizeRelFolder(project.exportSubdir)),
  })) {
    targets.push({ ...target, ...(await measureFolder(target.path)) })
  }
  return {
    character,
    folderAbs: location.folderAbs,
    targets,
    houdiniProjects: character.houdiniProjects.filter((hip) => /\.(hip|hipnc|hiplc)$/i.test(hip)),
  }
}

/**
 * What renaming this character would clear, and which projects it would follow
 * itself into. Read-only — nothing here writes.
 *
 * Measured against the character as it is NOW, i.e. before the rename: those
 * are the folders holding the old name's exports, which is exactly what the
 * dialog is asking the user to give up.
 */
export async function fetchCharacterRenameImpact({
  data,
}: {
  data: unknown
}): Promise<CharacterRenameImpact> {
  const { projectId, id } = charScopeInput.parse(data)
  if (!isTauri()) {
    return { folderAbs: '', targets: [], wipes: false, houdiniProjects: [], houdiniBlocked: '' }
  }
  const { folderAbs, targets, houdiniProjects } = await measureExportTrees(projectId, id)
  return {
    folderAbs,
    targets,
    wipes: hasExportFiles(targets),
    houdiniProjects,
    houdiniBlocked: houdiniProjects.length > 0 ? await houdiniUtilsReady() : '',
  }
}

const cleanupInput = charScopeInput.extend({
  /** The name the character had before this rename — every reference rewritten
   *  is derived from it. */
  previousName: z.string().min(1),
  /** Its folder before the rename, straight from the impact read. '' (or the
   *  folder it still has) means the rename did not move it. */
  previousFolder: z.string().default(''),
})

/** What the cleanup actually did, for the toast that reports it. */
export interface CharacterRenameCleanup {
  /** Folders cleared, with what they held. */
  wiped: Array<ExportWipeMeasure>
  /** `.hip` projects whose references now name the new export set. */
  houdiniUpdated: Array<string>
  /** References rewritten across all of them. */
  referencesUpdated: number
  /** `import_character_name` parms moved to the new slug. */
  namesUpdated: number
  /**
   * Everything that did not work, or that was deliberately left alone, in the
   * words the user needs — each naming its own manual fallback.
   *
   * Warnings rather than an exception, and that is the design: by the time this
   * runs the rename has already landed on disk, so failing here would leave the
   * user with a rename they cannot undo and an error they cannot act on.
   */
  warnings: Array<string>
}

/**
 * The other half of a rename: clear the export trees the old name owns, then
 * follow the rename into every linked Houdini project.
 *
 * Runs AFTER the save+generate, and re-reads the character from disk — by then
 * the folder has moved, `exportPath` has been re-derived and the scripts have
 * been regenerated at the new name, so every path here is already the new one
 * and the only thing still carrying the old name is what is being fixed.
 *
 * The Houdini leg is two ops in order, the same pairing a zip import uses:
 * `$JOB` first (a rename MOVES the character folder, so every project inside it
 * carries a `$JOB` naming a folder that is gone, and `$JOB/…` references with
 * it), then the retarget. Both are best-effort BY DESIGN — they need a paired
 * Houdini install to run hython at all — and every failure comes back as a
 * warning naming the fallback.
 *
 * What it deliberately does NOT do is run the export. Re-exporting is the
 * user's call and their time (a ROM build is tens of minutes); this only makes
 * sure that when they do, everything is already pointed at what it produces.
 */
export async function applyCharacterRenameCleanup({
  data,
}: {
  data: unknown
}): Promise<CharacterRenameCleanup> {
  const input = cleanupInput.parse(data)
  const result: CharacterRenameCleanup = {
    wiped: [],
    houdiniUpdated: [],
    referencesUpdated: 0,
    namesUpdated: 0,
    warnings: [],
  }
  if (!isTauri()) return result
  const { character, folderAbs, targets, houdiniProjects } = await measureExportTrees(
    input.projectId,
    input.id,
  )

  // --- the export trees -----------------------------------------------------
  for (const target of targets) {
    if (target.files === 0) continue
    try {
      if (await exists(target.path)) await remove(target.path, { recursive: true })
      // Both roots are SEEDED folders (`seedCharacterFolders`), and generation
      // re-creates the export root anyway — putting them back empty keeps the
      // character's layout browsable instead of leaving two holes in it.
      await mkdir(target.path, { recursive: true })
      result.wiped.push(target)
    } catch (e) {
      result.warnings.push(
        `The old ${target.kind === 'daz' ? 'Daz export' : 'Houdini export'} files could not be removed (${
          e instanceof Error ? e.message : String(e)
        }) — delete them by hand: ${target.path}`,
      )
    }
  }

  // --- the Houdini projects -------------------------------------------------
  if (houdiniProjects.length === 0) return result
  // Asked before anything is attempted, so a missing Houdini install produces
  // the one sentence that says what to do instead of a hython failure per
  // project.
  const blocked = await houdiniUtilsReady()
  if (blocked) {
    result.warnings.push(
      `The Houdini projects still import the old export set — ${blocked} Fix that and run Utils → “Repair project settings”, or repoint the DazToHue import paths by hand.`,
    )
    return result
  }
  try {
    // Only projects INSIDE the character folder get their `$JOB` repointed: the
    // studio's convention is that `$JOB` IS the character folder, and a project
    // the user keeps in their own tree is theirs to anchor. The retarget below
    // runs over all of them either way — a path swap is safe wherever the file
    // sits, because it only ever rewrites a value that names the old folder or
    // the old export name.
    const inside = houdiniProjects.filter((hip) => relativeInside(folderAbs, hip) !== null)
    if (inside.length > 0) {
      const defaults = await repairHoudiniDefaults({
        data: {
          targets: inside.map((hipPath) => ({ hipPath, jobDir: folderAbs })),
          dryRun: false,
        },
      })
      for (const entry of defaults.defaults) {
        if (!entry.ok) {
          result.warnings.push(
            `${basename(entry.hipPath)}: the project folder ($JOB) could not be repointed — ${entry.error}`,
          )
        }
      }
    }
    const report = await retargetHoudiniReferences({
      data: {
        hipPaths: houdiniProjects,
        nameFrom: exporterFigureName({ name: input.previousName }),
        nameTo: exporterFigureName(character),
        slugFrom: characterSlug({ name: input.previousName }),
        slugTo: characterSlug(character),
        folderFrom: movedFrom(input.previousFolder, folderAbs),
        folderTo: folderAbs,
        dryRun: false,
      },
    })
    for (const entry of report.retarget) {
      if (!entry.ok) {
        result.warnings.push(`${basename(entry.hipPath)}: ${entry.error}`)
        continue
      }
      result.referencesUpdated += entry.retargeted.length
      result.namesUpdated += entry.renamedNodes.length
      if (entry.retargeted.length > 0 || entry.renamedNodes.length > 0) {
        result.houdiniUpdated.push(entry.hipPath)
      }
      // Reported, never silently swallowed: both are places the old name
      // survives ON PURPOSE, and the user is the only one who can decide.
      for (const kept of entry.keptNames) {
        result.warnings.push(
          `${basename(entry.hipPath)}: “${kept}” was left alone — it doesn’t hold the old name, so it looks like a value you set yourself.`,
        )
      }
      for (const foreign of entry.foreign) {
        result.warnings.push(
          `${basename(entry.hipPath)}: “${foreign}” still points at the old export — it’s on one of your own nodes, so the studio left it to you.`,
        )
      }
    }
  } catch (e) {
    result.warnings.push(
      `The Houdini projects still import the old export set (${
        e instanceof Error ? e.message : String(e)
      }) — open each one and repoint its DazToHue import paths by hand.`,
    )
  }
  return result
}
