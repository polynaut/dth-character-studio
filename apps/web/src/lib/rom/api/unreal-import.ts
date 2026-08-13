import { exists, mkdir, readDir, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import {
  UNREAL_BRIDGE_UPLUGIN,
  UNREAL_JOB_VERSION,
  bridgeUpluginJson,
  bridgeVersionFrom,
  dthExportFiles,
  parseUnrealResult,
  unrealContentPath,
  unrealDestinationFor,
  unrealFolderFor,
  unrealImportStateFrom,
  unrealJobJson,
  unrealJobPaths,
} from '../unreal-jobs'
import type { UnrealImportState } from '../unreal-jobs'
import { charScopeInput, joinPath, locateCharacter, charsRoot, resolveProject } from './core'
import { normalizeRelFolder } from '../library'
// The bridge, bundled as source and rewritten into the project before every
// run — the same self-repairing rule as 456.py and the Daz runtime: small,
// must track the app version, and needs no install ritual.
import bridgeScript from '../unreal-runtime/dth_bridge.py?raw'
import bridgeInit from '../unreal-runtime/init_unreal.py?raw'

// The Unreal leg of the round trip: hand a `.dth` to a watching editor.
//
// Nothing here decides what an import DOES — that is mrpdean's DazToHue
// pipeline, unmodified. This module resolves paths, installs the studio's own
// bridge plugin, writes the job file and reads the result: the same division of
// labour as the Houdini leg.

/**
 * Write the bridge plugin into an Unreal project. Returns how many files it
 * wrote, so the install dialog can report it like every other item.
 *
 * A CHECKLIST ITEM, not a side effect of sending. It was the latter first —
 * rewritten before every run, on the "always current, no install ritual"
 * reasoning the Daz runtime and 456.py both use — and that was wrong here for
 * one reason those two don't have: an Unreal project is the user's own, plugins
 * in it are things they chose, and a `Plugins/` folder that grows on its own is
 * a surprise. It also hid the awkward part rather than solving it (Unreal loads
 * plugins at startup, so a bridge that appears mid-session does nothing until a
 * restart) — as an install action, the restart lands where the user already
 * expects one.
 *
 * Refreshing is still automatic in the sense that matters: every Install
 * (re)writes it, and the bridge REFUSES a job whose version it doesn't know
 * rather than silently doing the old thing, so a stale one says so.
 */
export async function installUnrealBridge({ data }: { data: unknown }): Promise<number> {
  const { uprojectPath } = z.object({ uprojectPath: z.string().min(1) }).parse(data)
  if (!isTauri()) throw new Error('Installing the bridge needs the desktop app.')
  const { bridgeDir } = unrealJobPaths(uprojectPath)
  const pythonDir = `${bridgeDir}/Content/Python`
  await mkdir(pythonDir, { recursive: true })
  const files: Array<[string, string]> = [
    [`${bridgeDir}/${UNREAL_BRIDGE_UPLUGIN}`, bridgeUpluginJson()],
    [`${pythonDir}/dth_bridge.py`, bridgeScript],
    [`${pythonDir}/init_unreal.py`, bridgeInit],
  ]
  // Distinct paths, so nothing races; the mkdir above already made the folder.
  await Promise.all(files.map(([path, text]) => storage.writeTextFileAtomic(path, text)))
  return files.length
}

const importInput = charScopeInput.extend({
  /** The linked `.uproject` to import into. */
  uprojectPath: z.string().min(1),
  /** Export-set names to send, when the caller knows which ones this run
   *  produced. Omitted/empty = every set in the character's export folder,
   *  which is what the character page's panel means by "send". */
  sets: z.array(z.string()).optional(),
})

export interface UnrealImportStarted {
  /** The export sets handed over, in job order. */
  sets: Array<{ name: string; destination: string; existing: boolean; files: number }>
  /** The Unreal content path a FRESH import goes to, for a single set (''
   *  for several). A re-import lands where the existing assets already are —
   *  the bridge decides that, and reports it back in the result. */
  destination: string
  /** True when a previous job was still sitting unclaimed — the editor was not
   *  watching, and this run replaced it rather than queueing behind it. */
  replacedPending: boolean
}

/** One thing Houdini exported for Unreal: a folder under the character's
 *  `export/` root, and the `.dth` manifest inside it. */
export interface UnrealExportSet {
  /** The export folder's name — the HDA's `character_name`, which is what the
   *  Unreal content folder gets named after. */
  name: string
  /** Absolute path of its `DTH_<name>.dth`. */
  dth: string
}

/**
 * Everything Houdini has exported for Unreal under a character's `export/`
 * root, newest last, by SCANNING for `<folder>/DTH_*.dth`.
 *
 * It used to guess ONE path — `<export>/<character.name>/DTH_<character.name>.dth`
 * — and that is wrong on the first real character it met. The folder is named
 * by the HDA's `character_name` parm, which the USER owns: measured on this
 * repo's own dev machine, the character `LaraCroft_G81` has three export sets
 * called `LaraCroft`, `LaraClassic` and `LaraNaked` (outfit variants), and not
 * one of them is the character's name. The guess found nothing and the send
 * reported "no Houdini export found" about a folder holding three.
 *
 * So: no guessing. One `readDir` of the export root, one of each subfolder.
 */
export async function unrealExportSets(exportRoot: string): Promise<Array<UnrealExportSet>> {
  if (!(await exists(exportRoot).catch(() => false))) return []
  let folders: Array<string> = []
  try {
    folders = (await readDir(exportRoot)).filter((e) => e.isDirectory).map((e) => e.name)
  } catch {
    return []
  }
  const sets = await Promise.all(
    folders.sort().map(async (name): Promise<UnrealExportSet | null> => {
      const dir = joinPath(exportRoot, name)
      try {
        const dth = (await readDir(dir)).find(
          (entry) => entry.isFile && /^DTH_.*\.dth$/i.test(entry.name),
        )
        return dth ? { name, dth: joinPath(dir, dth.name) } : null
      } catch {
        return null
      }
    }),
  )
  return sets.filter((set): set is UnrealExportSet => set !== null)
}

/** The installed bridge's contract version, or 0 when there is no bridge (or
 *  an unreadable one — the same answer, since neither can run a job). */
async function readBridgeVersion(bridgeDir: string): Promise<number> {
  const uplugin = `${bridgeDir}/${UNREAL_BRIDGE_UPLUGIN}`
  try {
    if (!(await exists(uplugin))) return 0
    return bridgeVersionFrom(await readTextFile(uplugin))
  } catch {
    return 0
  }
}

/**
 * Hand a character's Houdini output to a watching Unreal editor.
 *
 * Returns as soon as the job file is written — the editor claims it on its next
 * tick (about a second), and the caller polls {@link fetchUnrealImportProgress}.
 */
export async function startUnrealImport({ data }: { data: unknown }): Promise<UnrealImportStarted> {
  const input = importInput.parse(data)
  if (!isTauri()) {
    throw new Error('Importing into Unreal needs the desktop app.')
  }
  const project = await resolveProject(input.projectId)
  const location = await locateCharacter(charsRoot(project), input.id)
  if (!location) throw new Error('Character not found.')
  const character = await storage.readCharacterAt(location.definitionAbs)
  if (!character) throw new Error('Could not read the character definition.')
  if (!(await exists(input.uprojectPath))) {
    throw new Error('That Unreal project file is no longer on disk.')
  }

  // The character's FINAL export folder — where Houdini WRITES for Unreal.
  // Never `daz-export`, which is the regenerable Daz→Houdini intermediate the
  // Houdini imports READ (the same distinction `startHoudiniExport` draws).
  const exportRoot = joinPath(location.folderAbs, normalizeRelFolder(project.exportSubdir))
  // EVERY set, not one: a character's export folder holds one per HDA
  // `character_name`, and the studio cannot know those names (measured: three
  // outfit variants under one character). Sending "the" export would send an
  // alphabetical guess and silently drop the rest. A caller that wants a subset
  // passes `sets`.
  const available = await unrealExportSets(exportRoot)
  const wanted =
    input.sets && input.sets.length > 0
      ? available.filter((set) => input.sets?.some((name) => name.toLowerCase() === set.name.toLowerCase()))
      : available
  if (wanted.length === 0) {
    throw new Error(
      `No Houdini export found for ${character.name} — run the Houdini export first (looked in ${exportRoot}).`,
    )
  }

  const paths = unrealJobPaths(input.uprojectPath)
  // Nothing is installed from here — the bridge is an install-dialog item like
  // every other plugin. Without it there is no watcher, so the job would sit
  // unclaimed forever and the panel would blame a slow editor start; say what
  // is actually missing instead. The VERSION is checked in the same breath: an
  // old bridge refuses a job it cannot read, and being told that here beats
  // queueing one and reading the refusal back out of Unreal.
  const installedBridge = await readBridgeVersion(paths.bridgeDir)
  if (installedBridge === 0) {
    throw new Error(
      'The DTH Studio Bridge is not installed in this Unreal project — install it from the project card (Install), then restart the editor once.',
    )
  }
  if (installedBridge !== UNREAL_JOB_VERSION) {
    throw new Error(
      `This project has DTH Studio Bridge version ${installedBridge}; this studio writes version ${UNREAL_JOB_VERSION} jobs — re-install it from the project card, then restart the editor once.`,
    )
  }
  await mkdir(paths.jobDir, { recursive: true })

  // A result from an earlier run would be read as this one's before the editor
  // has written anything. The studio owns that cleanup, exactly as it does for
  // the Houdini result file.
  try {
    if (await exists(paths.resultFile)) await remove(paths.resultFile)
  } catch {
    // locked — the state rule tolerates a stale read until it is rewritten
  }
  const replacedPending = await exists(paths.jobFile).catch(() => false)

  // The manifest names its own outputs, so the job can say WHICH files this
  // export produced. The bridge uses them to find where they are already
  // imported — an unreadable manifest just means no matching, never a refusal
  // to send (the importer will report it far better than a path check here).
  // Where these sets already live in THIS project, worked out from disk — the
  // job then names the destination instead of the bridge hunting for it (see
  // `locateSets`: the hunt from inside Unreal was measured coming back empty).
  const located: Record<string, string> = await locateSets(
    paths.projectDir,
    wanted.map((set) => set.name),
  ).catch(() => ({}))
  const imports = await Promise.all(
    wanted.map(async (set) => ({
      dth: set.dth,
      // Where the set ALREADY is, else the default — named after the EXPORT
      // SET, not the character: the set's name is the HDA's `character_name`,
      // which is what separates three outfit variants of one character.
      destination: located[set.name] ?? unrealDestinationFor(set.name),
      existing: located[set.name] !== undefined,
      character: set.name,
      files: dthExportFiles(await readTextFile(set.dth).catch(() => '')),
    })),
  )
  await storage.writeTextFileAtomic(paths.jobFile, unrealJobJson(imports))
  return {
    sets: imports.map((one) => ({
      name: one.character,
      destination: one.destination,
      existing: one.existing,
      files: one.files.length,
    })),
    destination: imports.length === 1 ? imports[0].destination : '',
    replacedPending,
  }
}

/** How many folders one search may open before giving up. A Content tree is
 *  unbounded and this runs on a dialog open (and again per send); 2000 covers a
 *  real project comfortably and still cannot hang on a pathological one. */
const CONTENT_DIR_BUDGET = 2000

/**
 * Where each export set is ALREADY imported in this Unreal project, as content
 * paths (`/Game/Characters/Lara`), keyed by set name. Absent = not found.
 *
 * This is the studio's answer to a question the bridge could not answer from
 * inside Unreal. MEASURED 2026-08-13, on the first real end-to-end run: the
 * bridge's asset-registry lookup (`get_tag_value('AssetImportData')`) found
 * nothing and imported a second copy into `/Game/DazToHue/LaraClassic`, beside
 * the `/Game/Characters/Lara` the user already had. The data was never the
 * problem — reading the `.uasset` headers off disk shows exactly the FBX the
 * job names:
 *
 *     SKM_LaraClassic.uasset → "…/export/LaraClassic/Skeletal Meshes/SKM_LaraClassic.fbx"
 *
 * — so the API call was the weak link, and the filesystem is not. Every asset
 * the pipeline creates is named `<PREFIX>_<set>`, so `*_<set>.uasset` finds the
 * folder wherever the user moved it, and `Content/X/Y` → `/Game/X/Y` turns it
 * into the destination the job carries.
 *
 * Renamed assets still read as absent — the safe direction, since inventing a
 * destination would import ON TOP of something else.
 */
async function locateSets(
  projectDir: string,
  sets: ReadonlyArray<string>,
): Promise<Record<string, string>> {
  const found: Record<string, string> = {}
  if (sets.length === 0) return found
  const wanted = sets.map((name) => ({ name, suffix: `_${unrealFolderFor(name).toLowerCase()}.uasset` }))
  const contentDir = `${projectDir}/Content`
  const queue = [contentDir]
  let opened = 0
  while (queue.length > 0 && opened < CONTENT_DIR_BUDGET && Object.keys(found).length < sets.length) {
    const dir = queue.shift()
    if (dir === undefined) break
    opened += 1
    let entries
    try {
      // Sequential BY DESIGN: this stops as soon as every set is placed, and a
      // character three folders in should cost three reads, not a whole tree
      // walk fired off at once.
      // eslint-disable-next-line no-await-in-loop
      entries = await readDir(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory) {
        queue.push(`${dir}/${entry.name}`)
        continue
      }
      const name = entry.name.toLowerCase()
      for (const set of wanted) {
        if (found[set.name] === undefined && name.endsWith(set.suffix)) {
          const contentPath = unrealContentPath(projectDir, dir)
          if (contentPath) found[set.name] = contentPath
        }
      }
    }
  }
  return found
}

/** What the send UI needs to offer a choice: the character's export sets, and
 *  which of them each linked Unreal project already holds. */
export interface UnrealSendPlan {
  /** Every export set in the character's export folder, sorted. */
  sets: Array<string>
  /** Per linked `.uproject`: set name → the content path it sits at. A set
   *  missing from the record is NOT in that project. */
  located: Record<string, Record<string, string>>
}

/**
 * The send plan for one character: what could be sent, and what each linked
 * project already has.
 *
 * Both send surfaces pre-tick from this, and they pre-tick the same way: a set
 * the project ALREADY holds is a re-import (ticked), a set it doesn't is a
 * first import (offered, unticked). Putting a character into a project the
 * first time is a decision, not a continuation — the same rule the project rows
 * themselves use, applied one level down, after a send imported an outfit
 * variant nobody had asked for.
 *
 * Filesystem only — the studio cannot read an editor's asset registry from out
 * here — so this is {@link locateSets}'s filename search, with all the honesty
 * that implies: a project whose assets were renamed reads as "not here", which
 * offers an unticked row the user can tick rather than ticking one they didn't
 * mean.
 */
export async function fetchUnrealSendPlan({ data }: { data: unknown }): Promise<UnrealSendPlan> {
  const input = charScopeInput.parse(data)
  const plan: UnrealSendPlan = { sets: [], located: {} }
  if (!isTauri()) return plan
  const project = await resolveProject(input.projectId)
  const linked = project.unrealProjects ?? []
  const location = await locateCharacter(charsRoot(project), input.id)
  if (!location) return plan
  const exportRoot = joinPath(location.folderAbs, normalizeRelFolder(project.exportSubdir))
  plan.sets = (await unrealExportSets(exportRoot)).map((set) => set.name)
  if (plan.sets.length === 0 || linked.length === 0) return plan
  await Promise.all(
    linked.map(async (uprojectPath) => {
      const { projectDir } = unrealJobPaths(uprojectPath)
      plan.located[uprojectPath] = await locateSets(projectDir, plan.sets).catch(() => ({}))
    }),
  )
  return plan
}

/**
 * Poll one Unreal project's import.
 *
 * Reads only files, so it costs nothing when nothing is happening — and unlike
 * the other two legs it has no liveness probe: "is THAT project open in an
 * editor" is not answerable from a process list, so a closed editor leaves the
 * run reported as running rather than guessed dead.
 */
export async function fetchUnrealImportProgress({
  data,
}: {
  data: unknown
}): Promise<UnrealImportState | null> {
  const { uprojectPath } = z.object({ uprojectPath: z.string().min(1) }).parse(data)
  if (!isTauri()) return null
  const paths = unrealJobPaths(uprojectPath)
  const jobStillPending = await exists(paths.jobFile).catch(() => false)
  let result = null
  try {
    if (await exists(paths.resultFile)) {
      result = parseUnrealResult(await readTextFile(paths.resultFile))
    }
  } catch {
    result = null
  }
  if (!jobStillPending && result === null) {
    // Neither file: nothing was ever started for this project (or the caller
    // already dismissed it). Nothing to report rather than a made-up state.
    const claimed = await exists(paths.claimedFile).catch(() => false)
    if (!claimed) return null
  }
  return unrealImportStateFrom(jobStillPending, result)
}

/** Clear a finished run's files so the next poll reports nothing. */
export async function dismissUnrealImport({ data }: { data: unknown }): Promise<void> {
  const { uprojectPath } = z.object({ uprojectPath: z.string().min(1) }).parse(data)
  if (!isTauri()) return
  const paths = unrealJobPaths(uprojectPath)
  // Independent deletes, so they go together — and each swallows its own
  // failure: a file the editor has locked is cleared by the next run anyway.
  await Promise.all(
    [paths.resultFile, paths.jobFile, paths.claimedFile].map(async (path) => {
      try {
        if (await exists(path)) await remove(path)
      } catch {
        // locked by the editor — the next run overwrites them
      }
    }),
  )
}
