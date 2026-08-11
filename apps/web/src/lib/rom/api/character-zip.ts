import { invoke, isTauri } from '@tauri-apps/api/core'
import { exists, mkdir, readDir, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { z } from 'zod'

import { CHARACTER_SCHEMA_VERSION, newId } from '@dth/rom'

import { characterExportRoot } from '#/lib/scene-subfolder.ts'
import {
  CHARACTER_ZIP_FORMAT,
  CHARACTER_ZIP_FORMAT_VERSION,
  ZIP_CHARACTER_PREFIX,
  ZIP_IMAGES_PREFIX,
  ZIP_META_PREFIX,
  characterZipExclusions,
  characterZipFileName,
  characterZipManifestSchema,
  rekeyAvatarFileName,
  repointExecuteStampsText,
  repointExportFoldersRecordText,
  repointProductScansText,
  repointRomRunLogText,
} from '../character-zip'
import { LAST_ROM_RUN_FILE } from '../character-internals.ts'
import { PRODUCTS_FILE } from '../character-products.ts'
import { EXECUTE_STAMPS_FILE, EXPORT_FOLDERS_FILE } from '../execute-jobs.ts'
import { characterFolderName, definitionFileName, normalizeRelFolder, notesPathFor } from '../library'
import * as storage from '../storage'
import { relativeInside, renameWithRetry, uniqueFolder } from '../storage/fs'
import { deleteCharacter } from './characters'
import {
  basename,
  cacheCharacterLocation,
  charsRoot,
  dirname,
  invalidateCharacterLocations,
  joinPath,
  locateCharacter,
  resolveProject,
} from './core'
import { generateCharacterFiles } from './generate'
import { repairHoudiniDefaults, repathHoudiniReferences } from './houdini-material'
import { assertMovable } from './move'
import { exportZipReportSchema } from './native-types'

import type { Character } from '@dth/rom'
import type { CharacterZipManifest } from '../character-zip'
import type { ExportZipReport } from './native-types'

export type { CharacterZipManifest } from '../character-zip'
export type { ExportZipReport } from './native-types'

// Whole-character export/import: pack one character — its folder, its
// `.dcsmeta/characters/<folder>` files and its avatars — into a self-contained
// `.dcsc.zip`, and restore one over an existing character (overwrite) or as a
// new one (project-level drop). The pure rules (manifest schema, naming,
// exclusions, meta repointers) live in `../character-zip`; the zip work in Rust.

const exportInput = z.object({
  projectId: z.string().min(1),
  id: z.string().min(1),
  /** Pack the Daz→Houdini intermediate (`daz-export`, can be gigabytes). */
  includeDazExports: z.boolean(),
  /** Pack the FINAL export folder (the project's `exportSubdir`). */
  includeHoudiniExports: z.boolean(),
  /** The folder the zip lands in (the user's pick). */
  targetFolder: z.string().min(1),
})

/**
 * Pack a character into `<targetFolder>/<Name>_<date>.dcsc.zip`. Always packed:
 * the definition, the notes, every file the user keeps in the character folder
 * (Daz scenes, Houdini projects), the studio's per-character meta files and the
 * avatar images. The two export trees ride their toggles. Reads the character
 * FROM DISK — unsaved editor changes are not in the zip (the dialog says so).
 */
export async function exportCharacterZip({
  data,
}: {
  data: unknown
}): Promise<{ zipPath: string; report: ExportZipReport }> {
  const input = exportInput.parse(data)
  if (!isTauri()) throw new Error('Exporting a character needs the desktop app.')
  const project = await resolveProject(input.projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, input.id)
  if (!location) throw new Error('Character not found.')
  if (!location.relFolder) {
    throw new Error(
      'This character sits loosely at the project root, so its "folder" is the whole library — move it into its own folder first (the folder chip in the editor header), then export.',
    )
  }
  const character = await storage.readCharacterAt(location.definitionAbs)
  if (!character) throw new Error('The character definition could not be read.')

  const manifest: CharacterZipManifest = {
    format: CHARACTER_ZIP_FORMAT,
    formatVersion: CHARACTER_ZIP_FORMAT_VERSION,
    studioVersion: await storage.studioVersion(),
    exportedAt: new Date().toISOString(),
    characterId: character.id,
    characterName: character.name,
    definitionFile: basename(location.definitionAbs),
    sourceFolder: location.folderAbs,
    sourceProjectName: project.name,
    includes: {
      dazExports: input.includeDazExports,
      houdiniExports: input.includeHoudiniExports,
    },
  }
  const { excludeRel, excludeDirNames } = characterZipExclusions({
    exportSubdir: normalizeRelFolder(project.exportSubdir),
    includeDazExports: input.includeDazExports,
    includeHoudiniExports: input.includeHoudiniExports,
  })
  const zipPath = await freeZipPath(input.targetFolder, character.name)
  const report = exportZipReportSchema.parse(
    await invoke('export_character_zip', {
      request: {
        zipPath,
        manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
        roots: [
          {
            prefix: ZIP_CHARACTER_PREFIX,
            dir: location.folderAbs,
            excludeRel,
            excludeDirNames,
          },
          {
            prefix: ZIP_META_PREFIX,
            dir: storage.characterMetaDir(project.path, location.relFolder, character.id),
            excludeRel: [],
            excludeDirNames: [],
          },
        ],
        files: await characterAvatarFiles(project.path, character.id),
      },
    }),
  )
  return { zipPath, report }
}

/** First free `<folder>/<Name>_<date>[ (n)].dcsc.zip`. */
async function freeZipPath(folder: string, name: string): Promise<string> {
  const now = new Date()
  for (let attempt = 1; attempt <= 99; attempt++) {
    const candidate = joinPath(folder, characterZipFileName(name, now, attempt))
    if (!(await exists(candidate))) return candidate
  }
  throw new Error(`Could not find a free zip name in ${folder}.`)
}

/** The character's stored avatar files (masters + `.src` siblings, legacy names
 *  included — the same prefix rule `removeCharacterAvatars` deletes by). */
async function characterAvatarFiles(
  projectDir: string,
  characterId: string,
): Promise<Array<{ zipPath: string; path: string }>> {
  const dir = storage.metaImagesDir(projectDir)
  if (!(await exists(dir))) return []
  const id = basename(characterId)
  return (await readDir(dir))
    .filter((e) => e.isFile && (e.name.startsWith(`${id}.`) || e.name.startsWith(`${id}-`)))
    .map((e) => ({ zipPath: `${ZIP_IMAGES_PREFIX}/${e.name}`, path: joinPath(dir, e.name) }))
}

/**
 * Read + validate a zip's `manifest.json` — how a picked/dropped zip is judged
 * BEFORE anything is extracted. Throws a user-readable reason for a foreign
 * zip, and the honest "update the app" for a newer export format.
 */
export async function readCharacterZipManifest({
  data,
}: {
  data: unknown
}): Promise<CharacterZipManifest> {
  const { zipPath } = z.object({ zipPath: z.string().min(1) }).parse(data)
  if (!isTauri()) throw new Error('Importing a character needs the desktop app.')
  const text = z.string().parse(await invoke('read_character_zip_manifest', { zipPath }))
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('This zip is not a DTH Character Studio character export (unreadable manifest).')
  }
  const version =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>).formatVersion
      : undefined
  const format =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).format : undefined
  if (
    format === CHARACTER_ZIP_FORMAT &&
    typeof version === 'number' &&
    version > CHARACTER_ZIP_FORMAT_VERSION
  ) {
    throw new Error(
      `This character export was created by a newer studio (format v${version}; this build reads v${CHARACTER_ZIP_FORMAT_VERSION}). Update the app to import it.`,
    )
  }
  const parsed = characterZipManifestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error('This zip is not a DTH Character Studio character export.')
  }
  return parsed.data
}

const importInput = z.object({
  projectId: z.string().min(1),
  zipPath: z.string().min(1),
  /** `overwrite` replaces `targetId`'s character completely; `create` restores
   *  the zip as a new character (the project-level drop). */
  mode: z.enum(['overwrite', 'create']),
  targetId: z.string().optional(),
})

export interface CharacterZipImportResult {
  character: Character
  /** What the import could NOT fully fix — surfaced, never silent (a missing
   *  Houdini install, a failed regeneration). Empty = everything done. */
  warnings: Array<string>
}

/**
 * Restore a character from a `.dcsc.zip`.
 *
 * The zip is extracted to a staging folder and fully validated BEFORE any live
 * character is touched, so a refused/corrupt zip can never leave a half-
 * overwritten character behind. Then, for `overwrite`: the target character is
 * torn down completely (folder, meta, avatars, generated scripts — the delete
 * rails) and the staged tree takes its place; for `create`: the staged tree
 * becomes a new character folder under the project's characters root.
 *
 * Everything path-shaped is fixed for the new location: the definition's stored
 * paths (`repointCharacterPaths` — the single repoint site), the meta records
 * (export-folder record, execute stamps, run log, product scans), the avatar
 * references, and the Houdini projects — their `$JOB` is repointed at the new
 * character folder and their stored references repathed/rebuilt via the same
 * hython ops the Utils drawer runs. The generated artifacts (.dsa + PoseAsset
 * CSV) are regenerated so their baked paths match. Anything that can't be fixed
 * here (no Houdini install, generation failing) lands in `warnings`.
 *
 * A scene or `.hip` that was LINKED IN PLACE outside the character folder keeps
 * its original absolute path — on the same machine it still resolves; on
 * another machine it shows as missing and is relinked in the editor.
 */
export async function importCharacterZip({
  data,
}: {
  data: unknown
}): Promise<CharacterZipImportResult> {
  const input = importInput.parse(data)
  if (!isTauri()) throw new Error('Importing a character needs the desktop app.')
  if (input.mode === 'overwrite' && !input.targetId) {
    throw new Error('Overwrite import needs the character to overwrite.')
  }
  const project = await resolveProject(input.projectId)
  const lib = charsRoot(project)
  const manifest = await readCharacterZipManifest({ data: { zipPath: input.zipPath } })
  const warnings: Array<string> = []

  const staging = joinPath(
    storage.dcsmetaDir(project.path),
    `import-${Date.now().toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`,
  )
  try {
    await mkdir(staging, { recursive: true })
    z.number().parse(
      await invoke('extract_character_zip', {
        request: { zipPath: input.zipPath, destDir: staging },
      }),
    )
    const stagedCharDir = joinPath(staging, ZIP_CHARACTER_PREFIX)
    if (!(await exists(stagedCharDir))) {
      throw new Error('The zip holds no character folder — it is not a complete export.')
    }
    const stagedDef = joinPath(stagedCharDir, manifest.definitionFile)
    const staged = await storage.readCharacterAt(stagedDef)
    if (!staged) throw new Error(await unreadableStagedReason(stagedDef))

    // Resolve the target BEFORE tearing anything down.
    let targetLocation: storage.CharacterLocation | null = null
    if (input.mode === 'overwrite') {
      targetLocation = await locateCharacter(lib, input.targetId!)
      if (!targetLocation) throw new Error('The character to overwrite was not found.')
      if (!targetLocation.relFolder) {
        throw new Error(
          'The character to overwrite sits loosely at the project root (no folder of its own) — it cannot be replaced wholesale.',
        )
      }
      // The same lock gate as every folder-removing operation: a scene open in
      // Daz/Houdini aborts BEFORE anything is touched.
      await assertMovable(targetLocation.folderAbs)
    }
    // The zip's id is kept unless it already belongs to a DIFFERENT character
    // of this project (importing a copy beside its original) — then the
    // overwritten character keeps its own id, and a created one gets a fresh
    // one. The avatar files + reference are re-keyed to match.
    const conflicting = await locateCharacter(lib, staged.id)
    const idTaken =
      conflicting !== null &&
      (input.mode === 'create' ||
        conflicting.definitionAbs !== targetLocation!.definitionAbs)
    const finalId = !idTaken ? staged.id : input.mode === 'overwrite' ? input.targetId! : newId()

    // Teardown (overwrite): the full delete — folder, meta, avatars, generated
    // scripts — through the existing rails.
    let parentAbs = lib
    if (input.mode === 'overwrite') {
      parentAbs = dirname(targetLocation!.folderAbs)
      await deleteCharacter({ data: { projectId: input.projectId, id: input.targetId! } })
    }

    // The staged character folder takes its place (same volume — staging lives
    // in the project's `.dcsmeta`, so this is a rename, not a copy).
    invalidateCharacterLocations()
    await mkdir(parentAbs, { recursive: true })
    const destFolder = await uniqueFolder(parentAbs, characterFolderName(staged.name))
    await renameWithRetry(stagedCharDir, destFolder)
    const relFolder = normalizeRelFolder(relativeInside(lib, destFolder) ?? '')

    // The meta files, repointed to the new folder.
    const stagedMeta = joinPath(staging, ZIP_META_PREFIX)
    const metaDest = storage.characterMetaDir(project.path, relFolder, finalId)
    if (await exists(stagedMeta)) {
      if (await exists(metaDest)) await remove(metaDest, { recursive: true })
      await mkdir(dirname(metaDest), { recursive: true })
      await renameWithRetry(stagedMeta, metaDest)
      await repointMetaFiles(metaDest, manifest.sourceFolder, destFolder)
    }

    // The avatar images, re-keyed when the id changed (independent files, in
    // parallel — the removeCharacterAvatars pattern).
    const stagedImages = joinPath(staging, ZIP_IMAGES_PREFIX)
    if (await exists(stagedImages)) {
      const imagesDir = storage.metaImagesDir(project.path)
      await mkdir(imagesDir, { recursive: true })
      await Promise.all(
        (await readDir(stagedImages))
          .filter((entry) => entry.isFile)
          .map((entry) =>
            renameWithRetry(
              joinPath(stagedImages, entry.name),
              joinPath(imagesDir, rekeyAvatarFileName(entry.name, staged.id, finalId)),
            ),
          ),
      )
    }

    // The definition: every stored in-folder path repointed from the export-time
    // folder to the new one, identity + provenance restamped, the export root
    // re-derived (schema v29 — it is location-derived, never carried over).
    let final = manifest.sourceFolder
      ? storage.repointCharacterPaths(staged, manifest.sourceFolder, destFolder)
      : staged
    final = {
      ...final,
      id: finalId,
      image: rekeyAvatarFileName(final.image, staged.id, finalId),
      projectName: project.name,
      projectPath: project.path,
      updatedAt: new Date().toISOString(),
      studioVersion: await storage.studioVersion(),
      schemaVersion: CHARACTER_SCHEMA_VERSION,
      exportPath: characterExportRoot(destFolder, normalizeRelFolder(project.houdiniSubdir)),
    }
    const definitionAbs = joinPath(destFolder, definitionFileName(final.name))
    await storage.writeTextFileAtomic(definitionAbs, `${JSON.stringify(final, null, 2)}\n`)
    // A zip whose definition filename doesn't match its character name (legacy
    // renames): drop the stale staged copy, carry the notes to the new stem.
    const zipDef = joinPath(destFolder, manifest.definitionFile)
    if (basename(zipDef).toLowerCase() !== basename(definitionAbs).toLowerCase()) {
      try {
        if (await exists(zipDef)) await remove(zipDef)
        const oldNotes = notesPathFor(zipDef)
        const newNotes = notesPathFor(definitionAbs)
        if ((await exists(oldNotes)) && !(await exists(newNotes))) {
          await renameWithRetry(oldNotes, newNotes)
        }
      } catch {
        // a stray legacy-named file is harmless — never fail the import over it
      }
    }
    invalidateCharacterLocations()
    cacheCharacterLocation(lib, finalId, {
      definitionAbs,
      folderAbs: destFolder,
      relFolder,
      libraryFolder: lib,
    })

    // Regenerate the .dsa scripts + PoseAsset CSV so their baked paths (scene
    // paths, CSV delivery path) match the new location.
    try {
      await generateCharacterFiles({ data: { projectId: input.projectId, id: finalId } })
    } catch (e) {
      warnings.push(
        `The generated files could not be refreshed (${e instanceof Error ? e.message : String(e)}) — Save in the editor (or Tools → Refresh assets) regenerates them.`,
      )
    }

    // The Houdini projects' own stored state: `$JOB` repointed at the new
    // character folder, references repathed/rebuilt — the user's explicit
    // requirement, via the same hython ops the Utils drawer runs.
    warnings.push(
      ...(await fixImportedHoudiniPaths(input.projectId, finalId, final, destFolder)),
    )

    return { character: final, warnings }
  } finally {
    try {
      if (await exists(staging)) await remove(staging, { recursive: true })
    } catch {
      // a leftover staging folder is swept with the rest of `.dcsmeta` housekeeping
    }
  }
}

/** Why a staged definition failed to read — names the honest "newer studio"
 *  case instead of a generic "could not be read". */
async function unreadableStagedReason(stagedDef: string): Promise<string> {
  try {
    const raw = JSON.parse(await readTextFile(stagedDef)) as { schemaVersion?: unknown }
    if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > CHARACTER_SCHEMA_VERSION) {
      return `The zip's character was saved by a newer studio (schema v${raw.schemaVersion}; this build reads up to v${CHARACTER_SCHEMA_VERSION}). Update the app to import it.`
    }
  } catch {
    // fall through to the generic reason
  }
  return 'The character definition inside the zip could not be read.'
}

/** The meta files that record absolute paths, each with its repoint transform. */
const META_REPOINTERS: ReadonlyArray<{
  file: string
  fix: (text: string, fromFolder: string, toFolder: string) => string | null
}> = [
  { file: EXPORT_FOLDERS_FILE, fix: repointExportFoldersRecordText },
  { file: EXECUTE_STAMPS_FILE, fix: repointExecuteStampsText },
  { file: LAST_ROM_RUN_FILE, fix: repointRomRunLogText },
  { file: PRODUCTS_FILE, fix: repointProductScansText },
]

async function repointMetaFiles(
  metaDir: string,
  fromFolder: string,
  toFolder: string,
): Promise<void> {
  if (!fromFolder) return
  for (const { file, fix } of META_REPOINTERS) {
    const path = joinPath(metaDir, file)
    try {
      if (!(await exists(path))) continue
      const fixed = fix(await readTextFile(path), fromFolder, toFolder)
      if (fixed !== null) await storage.writeTextFileAtomic(path, fixed)
    } catch {
      // a garbled record is left alone — exactly how its readers treat it
    }
  }
}

/**
 * Fix the imported Houdini projects' own stored paths: `$JOB` → the new
 * character folder (repairHoudiniDefaults), then repath/rebuild stored
 * references against it (repathHoudiniReferences — its export-root donor is
 * what carries import paths across the relocation). Best-effort BY DESIGN:
 * both ops need a paired Houdini install (hython); every failure is returned
 * as a warning naming the manual fallback, never swallowed.
 */
async function fixImportedHoudiniPaths(
  projectId: string,
  characterId: string,
  character: Character,
  folderAbs: string,
): Promise<Array<string>> {
  const inside = character.houdiniProjects.filter(
    (hip) => /\.(hip|hipnc|hiplc)$/i.test(hip) && relativeInside(folderAbs, hip) !== null,
  )
  if (inside.length === 0) return []
  const problems: Array<string> = []
  try {
    const defaults = await repairHoudiniDefaults({
      data: { targets: inside.map((hipPath) => ({ hipPath, jobDir: folderAbs })), dryRun: false },
    })
    if (!defaults.ok && defaults.error) problems.push(defaults.error)
    const jobFixed: Array<string> = []
    for (const d of defaults.defaults) {
      if (d.ok) jobFixed.push(d.hipPath)
      else problems.push(`${basename(d.hipPath)}: $JOB could not be repaired — ${d.error}`)
    }
    if (jobFixed.length > 0) {
      const repath = await repathHoudiniReferences({
        data: {
          targets: jobFixed.map((hipPath) => ({ hipPath, jobDir: folderAbs })),
          projectId,
          characterId,
          dryRun: false,
        },
      })
      if (!repath.ok && repath.error) problems.push(repath.error)
      for (const r of repath.repath) {
        if (!r.ok) {
          problems.push(`${basename(r.hipPath)}: references could not be repathed — ${r.error}`)
        }
      }
    }
  } catch (e) {
    problems.push(
      `Houdini project paths were not adjusted (${e instanceof Error ? e.message : String(e)}). Fix them later via the character's Houdini Utils drawer: Repair $JOB, then Make paths portable.`,
    )
  }
  return problems
}
