import { exists, mkdir, readDir, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import {
  UNREAL_BRIDGE_UPLUGIN,
  UNREAL_BRIDGE_VERSION,
  bridgeUpluginJson,
  bridgeVersionFrom,
  dthExportFiles,
  parseUnrealJob,
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
// The `.uproject` opens through the same OS-association path as a `.hip` or a
// `.duf` — one place that decides what is safe to hand to the shell.
import { openScene } from './attachments'
import { normalizeRelFolder } from '../library'
// The bridge, bundled as source and written into the project by the INSTALL
// dialog — deliberately NOT the self-repairing rule 456.py and the Daz runtime
// use (see `installUnrealBridge` for why an Unreal project is different: its
// `Plugins/` folder is the user's, and Unreal only loads plugins at startup).
// Staleness is caught by reading the installed `.uplugin`'s version instead.
import bridgeScript from '../unreal-runtime/dth_runner.py?raw'
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
  if (!isTauri()) throw new Error('Installing the Runner needs the desktop app.')
  const { bridgeDir } = unrealJobPaths(uprojectPath)
  const pythonDir = `${bridgeDir}/Content/Python`
  await mkdir(pythonDir, { recursive: true })
  const files: Array<[string, string]> = [
    [`${bridgeDir}/${UNREAL_BRIDGE_UPLUGIN}`, bridgeUpluginJson()],
    [`${pythonDir}/dth_runner.py`, bridgeScript],
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
   *  produced. Omitted/empty = every set in the character's export folder —
   *  what the DTH Export dialog falls back to when the Houdini projects in the
   *  run have never been scanned, so their set names are unknown. */
  sets: z.array(z.string()).optional(),
})

export interface UnrealImportStarted {
  /** The export sets handed over, in job order — every one a re-import
   *  (`existing` is always true now; the field stays because the panel's rows
   *  read it, and a future contract change should not have to re-invent it). */
  sets: Array<{ name: string; destination: string; existing: boolean; files: number }>
  /** Sets this run produced that the project has never held — DROPPED from
   *  the job, because the send is re-import only (a first import is the
   *  user's own act inside Unreal). Named so the caller can say it out loud;
   *  a silent drop would read as "everything reached Unreal". */
  skipped: Array<string>
  /** The content path of the one import ('' for several) — where the existing
   *  assets already are, re-located by this send. */
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
 * Hand a character's Houdini output to a watching Unreal editor — as a
 * RE-import, only ever onto assets the project already holds. A set the
 * project has never seen is skipped (named in the return) or, when nothing at
 * all is there to re-import, refused: the first import of a character into a
 * project is a placement decision the user makes inside Unreal, not something
 * a batch run may do on their behalf.
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
    // Two different failures, and telling the user the wrong one costs them the
    // whole diagnosis. The folder being EMPTY means the export never ran. The
    // folder holding other names means it ran and the caller asked for sets it
    // does not contain — which the DTH Export dialog can now do, since it names
    // the sets from the Houdini projects' STORED SCAN rather than from disk. A
    // scan that predates a renamed export node says the run writes
    // `Lara_THICK` while Houdini has just written `LaraClassic_THICK`, and
    // "run the Houdini export first" is then advice to repeat what already
    // worked.
    throw new Error(
      available.length > 0
        ? `The export folder holds ${available.map((set) => set.name).join(', ')}, but this run was sending ${(input.sets ?? []).join(', ')} — the Houdini projects' scan is out of date. Rescan them (Utils drawer) and send again (looked in ${exportRoot}).`
        : `No Houdini export found for ${character.name} — run the Houdini export first (looked in ${exportRoot}).`,
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
      'The DTH Character Studio Runner is not installed in this Unreal project — install it from the project card (Install), then restart the editor once.',
    )
  }
  if (installedBridge !== UNREAL_BRIDGE_VERSION) {
    throw new Error(
      `This project has DTH Character Studio Runner v${installedBridge}; this studio ships v${UNREAL_BRIDGE_VERSION} — re-install it from the project card, then restart the editor once.`,
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

  // Where these sets already live in THIS project, worked out from disk — the
  // job then names the destination instead of the bridge hunting for it (see
  // `locateSets`: the hunt from inside Unreal was measured coming back empty).
  const located: Record<string, string> = await locateSets(
    paths.projectDir,
    wanted.map((set) => set.name),
  ).catch(() => ({}))
  // RE-import only: a set this project has never held is NOT sent. The first
  // import of a character is the user's own act inside Unreal (it decides
  // where in the project the character lives); the studio's leg exists to
  // land an updated export on assets that are already there. The skipped
  // names ride the return, so the drop is said rather than silent.
  const sendable = wanted.filter((set) => located[set.name] !== undefined)
  const skipped = wanted
    .filter((set) => located[set.name] === undefined)
    .map((set) => set.name)
  if (sendable.length === 0) {
    const projectName = (input.uprojectPath.split(/[\\/]/).pop() ?? input.uprojectPath).replace(
      /\.uproject$/i,
      '',
    )
    throw new Error(
      `${projectName} doesn't hold ${skipped.join(', ')} yet, and the studio only re-imports — make the first import in Unreal itself (open the project and import the DazToHue .dth once); after that, runs re-import it in place.`,
    )
  }
  // The manifest names its own outputs, so the job can say WHICH files this
  // export produced. The bridge uses them to find where they are already
  // imported — an unreadable manifest just means no matching, never a refusal
  // to send (the importer will report it far better than a path check here).
  const imports = await Promise.all(
    sendable.map(async (set) => ({
      dth: set.dth,
      // Where the set ALREADY is — named after the EXPORT SET, not the
      // character: the set's name is the HDA's `character_name`, which is
      // what separates three outfit variants of one character. (The
      // `unrealDestinationFor` default is unreachable behind the re-import
      // filter above; it stays as the typed fallback rather than an
      // assertion.)
      destination: located[set.name] ?? unrealDestinationFor(set.name),
      existing: true,
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
    skipped,
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

/** What the send UI needs to say what a send does: the character's export sets,
 *  and which of them each linked Unreal project already holds. */
export interface UnrealSendPlan {
  /** Every export set in the character's export folder, sorted. */
  sets: Array<string>
  /** Per linked `.uproject`: set name → the content path it sits at. Covers
   *  {@link UnrealSendPlan.sets} PLUS whatever `extraSets` asked about, and
   *  only those — a name that was never probed is absent for the same reason a
   *  name that was probed and not found is, so a caller that reads "missing"
   *  as "not in that project" must ask about every name it intends to report
   *  on. A set missing from the record after being probed is NOT in that
   *  project. */
  located: Record<string, Record<string, string>>
}

const sendPlanInput = charScopeInput.extend({
  /** Set names to probe for BEYOND the export folder's own — the sets a run is
   *  ABOUT to write, which by definition are not on disk yet.
   *
   * Without them `located` could only ever answer for sets a PREVIOUS run had
   * left behind, so the first export of a variant read as "that project does
   * not have it" when the question had never been asked — and the DTH Export
   * dialog states where each set lands, which is a claim it may only make
   * about names it actually looked for. */
  extraSets: z.array(z.string()).default([]),
})

/**
 * The send plan for one character: what could be sent, and what each linked
 * project already has.
 *
 * The DTH Export panel pre-ticks from this: a project holding a set THIS RUN
 * writes is a re-import (ticked); one holding none of them has nothing this
 * leg can do — the send is re-import ONLY, so its row goes inert and the
 * first import stays the user's own act inside Unreal. Putting a character
 * into a project the first time is a decision, not a continuation — the rule
 * that started as "offered, unticked" and hardened to "not offered at all"
 * after a send imported an outfit variant nobody had asked for.
 *
 * Filesystem only — the studio cannot read an editor's asset registry from out
 * here — so this is {@link locateSets}'s filename search, with all the honesty
 * that implies: a project whose assets were RENAMED reads as "not here", so its
 * sets are skipped (and named) like any other never-held set — rename the
 * assets back, or reimport them from inside Unreal. The safe direction: a
 * guessed destination would import ON TOP of something else.
 *
 * `sets` is the export folder; `located` answers for those AND for `extraSets`,
 * because "where does this land" has to be answerable about a set the run has
 * not written yet — see {@link sendPlanInput.extraSets}.
 */
export async function fetchUnrealSendPlan({ data }: { data: unknown }): Promise<UnrealSendPlan> {
  const input = sendPlanInput.parse(data)
  const plan: UnrealSendPlan = { sets: [], located: {} }
  if (!isTauri()) return plan
  const project = await resolveProject(input.projectId)
  const linked = project.unrealProjects ?? []
  const location = await locateCharacter(charsRoot(project), input.id)
  if (!location) return plan
  const exportRoot = joinPath(location.folderAbs, normalizeRelFolder(project.exportSubdir))
  plan.sets = (await unrealExportSets(exportRoot)).map((set) => set.name)
  // Deduped by exact spelling, not case-folded: `located` is keyed by the name
  // it was asked about, and the caller looks its own spelling back up. Keeping
  // both spellings costs one more filename suffix in the same walk; folding
  // them would key the answer under a spelling the caller never uses.
  const probe = [...new Set([...plan.sets, ...input.extraSets])]
  if (probe.length === 0 || linked.length === 0) return plan
  await Promise.all(
    linked.map(async (uprojectPath) => {
      const { projectDir } = unrealJobPaths(uprojectPath)
      plan.located[uprojectPath] = await locateSets(projectDir, probe).catch(() => ({}))
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

/**
 * Open the project in Unreal when its job is still sitting unclaimed and no
 * editor is running at all. Answers whether it launched one.
 *
 * The studio deliberately does not START Unreal to run an import — an editor
 * takes minutes to come up and holds its project, so a "launch and wait" leg
 * would be worse than useless. But a queued job with nothing to claim it is a
 * run that visibly does nothing, which is how this reads to the person who
 * pressed Start. Opening the project IS the rest of the leg: the bridge claims
 * the job on startup.
 *
 * TWO conditions, and both are about not guessing:
 *
 * - The job must still be PENDING. The claim is the only honest liveness probe
 *   the studio has — an editor with the bridge renames the file within about a
 *   second, so a job still sitting there means nothing is watching.
 * - No editor may be running AT ALL (`unreal_editor_running`). "Is THAT project
 *   open" cannot be answered from a process list, so this errs the safe way: an
 *   editor that is up — with the bridge missing, or with another project — is a
 *   reason not to launch a second one. A wrong guess costs a duplicate editor
 *   and several gigabytes; not launching costs a job that waits, which is what
 *   it did before this existed. The panel's amber notice covers that case.
 */
export async function openUnrealForPendingJob({ data }: { data: unknown }): Promise<boolean> {
  const { uprojectPath } = z.object({ uprojectPath: z.string().min(1) }).parse(data)
  if (!isTauri()) return false
  const paths = unrealJobPaths(uprojectPath)
  if (!(await exists(paths.jobFile).catch(() => false))) return false
  // A primitive return — parsed, never a bare `invoke<T>()` cast.
  const running = z.boolean().parse(await invoke('unreal_editor_running'))
  if (running) return false
  await openScene({ data: { scenePath: uprojectPath } })
  return true
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

/** One Unreal project's live (or just-landed) import, found again on disk —
 *  what a reloaded window re-arms its Unreal leg from. */
export interface UnrealAdoptedImport {
  uprojectPath: string
  /** Where the leg is, for the status line's first words — the poll takes
   *  over from there ('finished' toasts the outcome on its next tick). */
  state: 'waiting' | 'running' | 'finished'
  /** The sets the job carries for THIS character (name + re-import), in job
   *  order — the task rows. */
  sets: Array<{ name: string; existing: boolean }>
}

/**
 * Find this character's Unreal imports again after a reload — the leg's own
 * job files ARE its sidecar, exactly as the Daz batch and the Houdini run are
 * found again through theirs. Without this, navigating away (or reloading)
 * during the send silently dropped the rows, the status line and — worst —
 * the outcome toast, while the bridge worked on unwatched.
 *
 * Whose job a file is, per phase of the protocol:
 * - `job.json` / `running_job.json` say so themselves: their `dth` paths point
 *   into one character's export folder.
 * - a result ALONE (the bridge deletes the claimed file last, so this is a
 *   finished import) names only its export sets — matched against the sets in
 *   this character's export folder, the same filesystem answer the send
 *   itself was built from.
 *
 * Read-only: adopting must never advance, dismiss, or re-open anything — the
 * component's own poll does all of that once the watch is re-armed.
 */
export async function adoptUnrealImports({
  data,
}: {
  data: unknown
}): Promise<Array<UnrealAdoptedImport>> {
  const { projectId, id } = charScopeInput.parse(data)
  if (!isTauri()) return []
  try {
    const project = await resolveProject(projectId)
    const linked = project.unrealProjects ?? []
    if (linked.length === 0) return []
    const location = await locateCharacter(charsRoot(project), id)
    if (!location) return []
    const folder = `${location.folderAbs.replace(/\\/g, '/').toLowerCase()}/`
    // Lazy, shared: only a result-only (finished) adoption needs the set
    // names, and every project that does shares the one scan.
    let ownSetsPromise: Promise<Array<string>> | null = null
    const ownSets = () =>
      (ownSetsPromise ??= unrealExportSets(
        joinPath(location.folderAbs, normalizeRelFolder(project.exportSubdir)),
      ).then((sets) => sets.map((set) => set.name.toLowerCase())))
    const adopted = await Promise.all(
      linked.map(async (uprojectPath): Promise<UnrealAdoptedImport | null> => {
        const paths = unrealJobPaths(uprojectPath)
        const jobText =
          (await readTextFile(paths.jobFile).catch(() => null)) ??
          (await readTextFile(paths.claimedFile).catch(() => null))
        if (jobText !== null) {
          const job = parseUnrealJob(jobText)
          const mine = (job?.imports ?? []).filter((one) =>
            one.dth.replace(/\\/g, '/').toLowerCase().startsWith(folder),
          )
          if (mine.length === 0) return null
          const jobStillPending = await exists(paths.jobFile).catch(() => false)
          return {
            uprojectPath,
            state: jobStillPending ? 'waiting' : 'running',
            sets: mine.map((one) => ({ name: one.character, existing: one.existing })),
          }
        }
        const resultText = await readTextFile(paths.resultFile).catch(() => null)
        if (resultText === null) return null
        const result = parseUnrealResult(resultText)
        if (!result || result.imports.length === 0) return null
        const names = await ownSets()
        const mine = result.imports.filter((one) => names.includes(one.character.toLowerCase()))
        if (mine.length === 0) return null
        return {
          uprojectPath,
          state: result.state === 'running' ? 'running' : 'finished',
          sets: mine.map((one) => ({ name: one.character, existing: one.mode === 'reimport' })),
        }
      }),
    )
    return adopted.filter((one): one is UnrealAdoptedImport => one !== null)
  } catch {
    // Read-only convenience, like adoptHoudiniRun: a failed adoption leaves
    // the leg invisible, which is exactly the behaviour it replaces.
    return []
  }
}
