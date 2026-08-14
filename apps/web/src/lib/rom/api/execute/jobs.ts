/**
 * The handoff itself: what the studio hands the Runner (the job file), which
 * scenes are affected, launching Daz for a pending batch, and generating a ROM
 * animation.
 *
 * Top of `api/execute/` alongside `scans.ts` — imports `primitives.ts` and
 * `run-state.ts`, and nothing imports this but the barrel. `scans.ts` is its
 * PEER, not its consumer: the two never reference each other.
 */
import { exists, readTextFile, remove, rename, stat } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../../storage'
import {
  EXPORTER_JOB_FILE,
  EXPORT_MODES,
  HOUDINI_RUN_MODES,
  RUNNING_JOB_FILE,
  executeSceneSignature,
  jobFileJson,
  isReclaimableBatch,
  jobSceneForMode,
  jobScriptForMode,
  jobStepsForMode,
  normalizeSceneKey,
  parseJobFileJson,
  romAnimationPath,
  sceneExportFolderRel,
} from '../../execute-jobs'
import { BUILD_ROM_ANIMATION_SCRIPT, cancelFlagPath, sceneExportName } from '@dth/rom'
import { sceneDthPath } from '../../houdini-jobs'
import { charScopeInput, joinPath } from '../core'
import type { ExecuteStamp, ExecuteStamps, ExporterJob } from '../../execute-jobs'
import type { Character } from '@dth/rom'

import {
  OPEN_SCENE_PICKUP_TIMEOUT_MS,
  OPEN_SCENE_POLL_MS,
  assertHandoffOwned,
  characterScenesRoot,
  dazStudioRunningNative,
  exporterJobFilePaths,
  launchDazSceneless,
  loadCharacter,
  mtimeOf,
  readStamps,
  stampsPath,
  writeStamps,
} from './primitives.ts'
import {
  clearCancelFlag,
  resetExportProgressLog,
  runOwner,
  writeExportRunSidecar,
} from './run-state.ts'

export interface ExecuteSceneStatus {
  scenePath: string
  primary: boolean
  /** Inputs changed since the last handoff (or never handed off) — the panel's
   *  default check. Always false when the `.duf` is missing. */
  affected: boolean
  /** The `.duf` can't be read — the row can't be exported. */
  missing: boolean
  /** A saved ROM animation exists — "Export only" has something to export
   *  (rows without one are disabled in that mode). */
  romExists: boolean
  /**
   * …and it is NEWER than what that scene last delivered into the export dir
   * — a ROM (re)built or hand-edited in Daz since the last export. What "Export
   * only" pre-checks: exactly the scenes whose saved ROM hasn't been exported
   * as it now stands. False without a ROM animation.
   */
  romUnexported: boolean
  /** The scene's last Daz export is on disk (the `.dth` at {@link sceneDthPath}
   *  — the file a Houdini network imports). What "Houdini only" runs on; rows
   *  without one are disabled in that mode (nothing to rely on). */
  exportExists: boolean
}

/**
 * Every linked scene with its affected-state + saved-ROM state — what the DTH
 * Export panel pre-checks (per mode). Per-scene tolerant: an unreadable `.duf`
 * reports `missing` instead of throwing (the panel disables that row).
 */
export async function fetchExecuteScenes({ data }: { data: unknown }): Promise<Array<ExecuteSceneStatus>> {
  const { projectId, id } = charScopeInput.parse(data)
  if (!isTauri()) return []
  const { project, location, character } = await loadCharacter(projectId, id)
  const stored = await readStamps(stampsPath(project, location, id))
  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  // Where each scene's export lands, for the "has this ROM been exported as it
  // now stands?" compare below. The delivered PoseAsset CSV is the marker: the
  // run-time copy writes exactly one per scene, named after that scene's export
  // set — so its mtime IS that scene's last successful export.
  const scenesRootAbs = characterScenesRoot(character, location, project.dazSubdir ?? 'daz3d')
  const folders = sceneExportFolderRel(character, scenesRootAbs)
  const exportDir = character.exportPath.trim()
  return Promise.all(
    linked.map(async (scenePath, index) => {
      const primary = index === 0
      const key = normalizeSceneKey(scenePath)
      const romMtime = await mtimeOf(romAnimationPath(scenePath))
      let romUnexported = false
      if (romMtime > 0 && exportDir) {
        const { folder, sub } = folders[key] ?? { folder: '', sub: '' }
        const name = sceneExportName(character, key, sub)
        const delivered = joinPath(exportDir, folder, `${name}_pose_asset.csv`)
        // Never exported (no delivered CSV, mtime 0) counts as unexported.
        romUnexported = romMtime > (await mtimeOf(delivered))
      }
      // The `.dth` a Houdini network imports — "Houdini only" runs off this
      // delivered file alone, so its on-disk presence is that mode's gate.
      const dth = sceneDthPath(character, key, scenesRootAbs)
      const exportExists = dth !== '' && (await mtimeOf(dth)) > 0
      let info: Awaited<ReturnType<typeof stat>>
      try {
        info = await stat(scenePath)
      } catch {
        return {
          scenePath,
          primary,
          affected: false,
          missing: true,
          romExists: romMtime > 0,
          romUnexported,
          exportExists,
        }
      }
      const prev = stored.scenes[key]
      const affected =
        prev === undefined ||
        prev.mtimeMs !== (info.mtime?.getTime() ?? 0) ||
        prev.size !== info.size ||
        prev.signature !== executeSceneSignature(character, scenePath)
      return {
        scenePath,
        primary,
        affected,
        missing: false,
        romExists: romMtime > 0,
        romUnexported,
        exportExists,
      }
    }),
  )
}

export const executeInput = charScopeInput.extend({
  /** The scenes to enqueue, chosen in the DTH Export panel — each must be one
   *  of the character's linked scenes. */
  scenes: z.array(z.string().min(1)).min(1),
  /** What the run does — the panel's first step. Defaults to the full
   *  ROM + export run (see {@link ExportMode}). */
  mode: z.enum(EXPORT_MODES).default('rom-export'),
  /** The Houdini projects selected for the after-batch continuation, in list
   *  order; [] = none. Each must be one of the character's linked projects. */
  houdiniProjects: z.array(z.string().min(1)).default([]),
  /** What the selected projects do once the batch finishes — the Houdini
   *  list's Mode dropdown ({@link HoudiniRunMode}). Meaningless without a
   *  project. It drives the user's own Houdini, so nothing runs unless the
   *  dialog selected a project explicitly (or via its involved-projects
   *  auto-selection). */
  houdiniMode: z.enum(HOUDINI_RUN_MODES).default('export-selected'),
  /** Linked Unreal projects the finished export is sent to, after the Houdini
   *  queue. [] = none, which is every run that isn't asked for one. */
  unrealProjects: z.array(z.string().min(1)).default([]),
  /** The export sets to send — the ones this run puts in play. [] = the studio
   *  could not name them, and the send falls back to every set in the export
   *  folder; `unrealProjects` is what decides whether anything is sent. */
  unrealSets: z.array(z.string()).default([]),
})

export interface ExecuteJobsSummary {
  /** Absolute path of the job file written. */
  jobFile: string
  /** Scenes whose jobs were enqueued, in job order. */
  scenes: Array<string>
  /** True when a fresh Daz Studio was started for the jobs. */
  dazLaunched: boolean
  /** True when a "running" Daz never claimed the batch — it is most likely
   *  still shutting down (the process lingers after close). The job file is
   *  left pending; the UI waits for the exit and starts Daz via
   *  {@link launchDazForPendingJobs}. */
  dazClosing?: boolean
  /** True when Daz was already running — the plugin's regular poll picks the
   *  job file up in that instance, no restart needed. */
  dazWasRunning: boolean
}

/** A scene's current stamp: the `.duf` file identity + the definition signature. */
export async function currentStamp(character: Character, scenePath: string): Promise<ExecuteStamp> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(scenePath)
  } catch {
    throw new Error(
      `The Daz scene file could not be read:\n${scenePath}\nRelink or restore the scene, then try again.`,
    )
  }
  return {
    mtimeMs: info.mtime?.getTime() ?? 0,
    size: info.size,
    signature: executeSceneSignature(character, scenePath),
  }
}

/**
 * Write the DTH Exporter job file (JSON, contract v2) for the chosen scenes
 * and start Daz Studio.
 *
 * One row per scene: the hidden bulk script (.Bulk_ROM_Export.dsa) — it
 * always builds the ROM and always exports everything (the split/hair toggles
 * only govern the visible per-character scripts). The job file replaces any
 * pending one (last write wins), and a stale `running_` file from an earlier
 * unwatched/dead batch is cleaned up first (the Runner never deletes it —
 * cleanup is the studio's). Scenes are stamped at handoff.
 *
 * Throws with a user-facing message when preconditions fail: no DAZ library
 * configured, no export directory, generated scripts missing (save first), or
 * a scene file that can't be read.
 */
export async function executeCharacterJobs({ data }: { data: unknown }): Promise<ExecuteJobsSummary> {
  const {
    projectId,
    id,
    scenes: chosen,
    mode,
    houdiniProjects,
    houdiniMode,
    unrealProjects,
    unrealSets,
  } = executeInput.parse(data)
  if (!isTauri()) throw new Error('DTH Export needs the desktop app (Daz Studio is launched natively).')

  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) {
    throw new Error('Set “My DAZ 3D Library” in Settings first — the job file and the generated scripts live there.')
  }

  const { project, location, character } = await loadCharacter(projectId, id)
  if (!character.scenePath) {
    throw new Error('No primary Daz scene is linked — link one before exporting.')
  }
  // The exporting runs exist to deliver exports — without an export directory
  // they would build and export nothing. The UI disables the button; backstop
  // here. A ROM-only run writes its `rom-animations` scene beside the source
  // scene, so it needs no export dir at all.
  if (mode !== 'rom-only' && !character.exportPath.trim()) {
    throw new Error('DTH Export needs an export directory — set one in the Export directory panel.')
  }

  // Resolve each chosen scene to its linked spelling (the dialog passes them
  // verbatim, but be tolerant of separator/case differences).
  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const scenes = chosen.map((scene) => {
    const match = linked.find((s) => normalizeSceneKey(s) === normalizeSceneKey(scene))
    if (!match) throw new Error(`The scene is not linked to this character anymore:\n${scene}`)
    return match
  })

  // The after-export Houdini projects must be among the character's LINKED
  // projects (the dialog only offers those; backstop against a stale pick).
  const hips = houdiniProjects.map((hip) => {
    const match = character.houdiniProjects.find(
      (p) => normalizeSceneKey(p) === normalizeSceneKey(hip),
    )
    if (!match) {
      throw new Error(`The Houdini project is not linked to this character anymore:\n${hip}`)
    }
    return match
  })

  // ROM only writes no fresh export — an export continuation would re-consume
  // the PREVIOUS `.dth`s while the report reads as the new ROM's round trip.
  // The dialog forces `skip` there; this is the loud backstop against any
  // other caller.
  if (mode === 'rom-only' && hips.length > 0 && houdiniMode !== 'skip') {
    throw new Error(
      'ROM only writes no export for Houdini to run on — use "Skip Houdini", or deselect the Houdini projects.',
    )
  }

  // The generated scripts must exist on disk — the export runs what generation
  // wrote, so an unsaved/never-generated character has nothing to hand off.
  const scriptsDir = storage.studioCharScriptsDir(
    settings.dazLibraryFolder,
    project.name,
    character.name,
  )
  const scriptPath = joinPath(scriptsDir, jobScriptForMode(mode))
  if (!(await exists(scriptPath))) {
    throw new Error(`The generated script is missing:\n${scriptPath}\nSave the character to regenerate it, then try again.`)
  }

  // Current stamps for every chosen scene (also validates the .duf files exist).
  const stamps = new Map<string, ExecuteStamp>()
  for (const scene of scenes) {
    stamps.set(scene, await currentStamp(character, scene))
  }

  // One row per scene, in run order. "Export only" opens each scene's SAVED ROM
  // animation instead of the scene itself — that is where the built ROM lives,
  // and the script maps the file back to its source scene for every scene-keyed
  // lookup. Without one there is nothing to export, so say so rather than
  // handing Daz a row that can only fail.
  const jobs: Array<ExporterJob> = []
  for (const scene of scenes) {
    const jobScene = jobSceneForMode(mode, scene)
    if (mode === 'export-only' && !(await exists(jobScene))) {
      throw new Error(
        `No saved ROM animation for this scene yet:\n${scene}\nRun a ROM build for it first (DTH Export → ROM + Export or ROM only), then export.`,
      )
    }
    // `steps` = the row's per-scene percent scale in the verbose progress log
    // (Runner v1.2.0 + the generated script's own dthProgressLog lines).
    jobs.push({ scenePath: jobScene, scriptPath, steps: jobStepsForMode(mode) })
  }
  const scriptsRoot = storage.studioScriptsDir(settings.dazLibraryFolder)
  const jobFile = joinPath(scriptsRoot, EXPORTER_JOB_FILE)
  // A leftover `running_` file (a finished batch nobody watched, or a dead
  // one) would block the Runner's rename — the studio owns its cleanup. But a
  // LIVE batch — sub-100 with Daz still up (another window's export, or a
  // Tools genesis-index build) — must never be clobbered: one job file, one
  // batch at a time, same refusal as every other handoff writer.
  const staleRunning = joinPath(scriptsRoot, RUNNING_JOB_FILE)
  if (await exists(staleRunning).catch(() => false)) {
    const finished = await readTextFile(staleRunning)
      .then((text) => parseJobFileJson(text)?.progress === 100)
      // Unreadable or torn: assume a live batch — refusing is the safe guess.
      .catch(() => false)
    if (!finished) {
      // ANY Daz: the next line DELETES someone else's claimed batch, so this
      // must not answer about one install while another is working (see
      // DazRunningScope). The refusal names the manual way out, because "a Daz
      // is open" is exactly the state in which a genuinely stale file can never
      // clean itself up.
      const dazRunning = await dazStudioRunningNative(true, 'any')
      if (dazRunning) {
        throw new Error(
          'Daz Studio is working through a batch — try again when it finishes.\nIf that batch is stuck, clear it in Settings → App Data → DTH Exporter job file.',
        )
      }
      // Daz gone below 100 = a dead run; fall through and clean it up.
    }
    await remove(staleRunning).catch(() => {
      // best effort — the Runner also clears a stale running file before renaming
    })
  }
  // The verbose progress log (Runner v1.2.0): one app-data file, truncated at
  // every handoff so a stale log never reads as this run's — the Runner
  // truncates it again at pickup, and both writers append from there. This is
  // the one handoff that also ARMS it (see resetExportProgressLog).
  const progressLogPath = await resetExportProgressLog()
  // A leftover interrupt flag would make every script of THIS batch skip its
  // scene — the run would look like it worked and export nothing. Clearing it
  // is the arming step that matches the progress log's truncation above.
  const cancelPath = cancelFlagPath(
    storage.characterMetaDir(project.path, location.relFolder, id),
  )
  await clearCancelFlag(cancelPath)
  await storage.writeTextFileAtomic(jobFile, jobFileJson(jobs, 'bulk-export', progressLogPath))

  // Arm the watch: the run's identity only — all live state (progress,
  // per-job statuses) is Runner-owned inside the renamed job file. The
  // sidecar mirrors it to disk so a reloaded window can restore the watch.
  runOwner.current = {
    characterId: character.id,
    total: jobs.length,
    startedAtMs: Date.now(),
    houdiniProjects: hips,
    houdiniMode,
    scenes,
    unrealProjects,
    unrealSets,
    mode,
    cancelPath,
  }
  await writeExportRunSidecar(runOwner.current)

  // Stamp the handoff (merge — untouched scenes keep their stamps), but ONLY
  // for the full run: a stamp claims "this definition, as it stands, has been
  // exported". A ROM-only run exports nothing, and an export-only run ships
  // whatever the saved ROM holds — which may predate the current definition.
  // Stamping either would make the dialog report scenes as up to date when
  // their current inputs never reached Houdini.
  if (mode === 'rom-export') {
    const path = stampsPath(project, location, id)
    const stored = await readStamps(path)
    // Carry ONLY the stamps of scenes still linked (same normalization the
    // stamps are keyed by): unlink after unlink used to accrete dead keys
    // forever — the store is rewritten wholesale here anyway, and a scene
    // re-linked later SHOULD read as affected (its stamp dates a link that no
    // longer existed in between).
    const linkedKeys = new Set(linked.map(normalizeSceneKey))
    const nextStamps: ExecuteStamps = { version: 1, scenes: {} }
    for (const [key, stamp] of Object.entries(stored.scenes)) {
      if (linkedKeys.has(key)) nextStamps.scenes[key] = stamp
    }
    for (const scene of scenes) {
      const stamp = stamps.get(scene)
      if (stamp) nextStamps.scenes[normalizeSceneKey(scene)] = stamp
    }
    await writeStamps(path, nextStamps)
  }

  // Start Daz scene-less when it isn't running; a running instance needs
  // nothing — the plugin polls for the job file and picks it up in place.
  const dazWasRunning = await dazStudioRunningNative(false, 'export')
  let dazLaunched = false
  let dazClosing = false
  if (!dazWasRunning) {
    await launchDazSceneless('minimized')
    dazLaunched = true
  } else {
    // A "running" Daz may actually be SHUTTING DOWN — the process lingers a
    // while after close, its Runner poller is already gone, and a fresh launch
    // now would just die against the dying single instance. A live Runner
    // claims (renames) the file within one poll interval; when the claim never
    // comes, report the batch as unclaimed so the UI can wait for the process
    // to exit and start Daz itself (the job file stays pending — and stays
    // abortable — until then).
    const deadline = Date.now() + OPEN_SCENE_PICKUP_TIMEOUT_MS
    let pickedUp = false
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, OPEN_SCENE_POLL_MS))
      if (!(await exists(jobFile).catch(() => true))) {
        pickedUp = true
        break
      }
    }
    dazClosing = !pickedUp
  }
  return { jobFile, scenes, dazLaunched, dazWasRunning, dazClosing }
}

/**
 * Start Daz Studio for a still-pending export handoff — the waiting modal's
 * finish, once the closing Daz process is finally gone. No-op when the handoff
 * disappeared meanwhile (aborted, or claimed after all); a Daz already running
 * again (the user restarted it themselves) counts as success — its Runner
 * picks the pending file up on its own.
 */
export async function launchDazForPendingJobs(): Promise<boolean> {
  if (!isTauri()) return false
  const paths = await exporterJobFilePaths()
  if (!paths) return false
  if (!(await exists(paths.pending).catch(() => false))) {
    // No pending file — but that is not necessarily "nothing to do". A Daz that
    // was CLOSING can claim the batch on a final poll tick (the rename IS the
    // claim) and then exit before running a single row, and the Runner only
    // ever polls for the PENDING name — so a `running_` file left that way is
    // orphaned forever. Take it back.
    if (!(await reclaimOrphanedBatch(paths))) return false
  }
  if (await dazStudioRunningNative(false, 'export')) return true
  await launchDazSceneless('minimized')
  return true
}

/**
 * Rename an orphaned `running_` batch back to pending so a fresh Daz's Runner
 * can claim it. True when one was reclaimed.
 *
 * Deliberately narrow — only an untouched `bulk-export` batch on which
 * **nothing has run yet** ({@link isReclaimableBatch}: progress 0, every row
 * still `pending`). A partially worked batch is a different story: re-running
 * it would redo finished scenes, and the export watch already reports that
 * case as a dead run. Callers must have established that Daz is gone; a live
 * Daz owns its running file. This is the ONE place that performs the rename —
 * the export watch only detects the state and defers to it
 * (fetchExportRunProgress).
 */
export async function reclaimOrphanedBatch(paths: { pending: string; running: string }): Promise<boolean> {
  try {
    if (!(await exists(paths.running))) return false
    // Parsed ONLY to gate on the untouched state — the file itself moves as-is.
    const parsed = parseJobFileJson(await readTextFile(paths.running))
    if (!isReclaimableBatch(parsed)) return false
    // One atomic rename, no rewrite: no window where both files (or neither)
    // exist, and the pending file keeps the claimed file's exact bytes instead
    // of a re-serialization that could reshape what it never parsed.
    await rename(paths.running, paths.pending)
    return true
  } catch {
    return false
  }
}

export const generateRomInput = charScopeInput.extend({
  /** The linked scene to build + save the ROM animation for. */
  scenePath: z.string().min(1),
})

/**
 * Hand a ROM-ANIMATION build for ONE scene to the Runner: a one-row
 * bulk-export batch pointing at the hidden ROM-only script
 * ({@link BUILD_ROM_ANIMATION_SCRIPT}, runtime v43) — it builds the ROM and
 * saves the reopenable `rom-animations/<stem>_ROM.duf`, exporting nothing.
 * The scene card polls for that file (its path is returned) and opens it when
 * it appears. Same handoff mechanics as {@link executeCharacterJobs} — stale
 * `running_` cleanup, Daz launched when closed — but NO handoff stamps: this
 * run delivers no export, so it must not mark the scene "exported".
 */
export async function generateRomAnimation({
  data,
}: {
  data: unknown
}): Promise<{ romPath: string; dazWasRunning: boolean; startedAt: number }> {
  const { projectId, id, scenePath } = generateRomInput.parse(data)
  if (!isTauri()) throw new Error('Generating a ROM animation needs the desktop app.')
  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) {
    throw new Error('Set “My DAZ 3D Library” in Settings first — the job file and the generated scripts live there.')
  }
  const { project, character } = await loadCharacter(projectId, id)
  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const scene = linked.find((s) => normalizeSceneKey(s) === normalizeSceneKey(scenePath))
  if (!scene) throw new Error(`The scene is not linked to this character anymore:\n${scenePath}`)
  const scriptPath = joinPath(
    storage.studioCharScriptsDir(settings.dazLibraryFolder, project.name, character.name),
    BUILD_ROM_ANIMATION_SCRIPT,
  )
  if (!(await exists(scriptPath))) {
    throw new Error(
      `The generated script is missing:\n${scriptPath}\nSave the character to regenerate it, then try again.`,
    )
  }
  const paths = await exporterJobFilePaths()
  if (!paths) throw new Error('Set “My DAZ 3D Library” in Settings first.')
  // One global job file, one batch at a time — never clobber an export handoff.
  if (await exists(paths.pending)) {
    throw new Error('An export batch is waiting for Daz Studio — let it start (or abort it) first.')
  }
  if (await exists(paths.running)) {
    const finished = await readTextFile(paths.running)
      .then((text) => parseJobFileJson(text)?.progress === 100)
      // Unreadable or torn: assume a live batch — refusing is the safe guess.
      .catch(() => false)
    if (!finished) {
      throw new Error('Daz Studio is working through an export batch — try again when it finishes.')
    }
    await remove(paths.running).catch(() => {})
  }
  // This batch arms no progress log — but it must not INHERIT the last
  // export's (see resetExportProgressLog). Best effort: a log that could not
  // be truncated is stale display data, never a reason to refuse the run.
  await resetExportProgressLog().catch(() => {})
  const jobJson = jobFileJson([{ scenePath: scene, scriptPath }])
  await storage.writeTextFileAtomic(paths.pending, jobJson)
  // Both windows can pass the exists-checks above — the read-back decides who
  // actually holds the handoff (see assertHandoffOwned).
  await assertHandoffOwned(paths.pending, jobJson)
  const startedAt = Date.now()
  const dazWasRunning = await dazStudioRunningNative(false, 'export')
  if (!dazWasRunning) {
    // 'visible': this one opens a scene the user picked and leaves the built ROM
    // on its timeline to look at — the one job-file flow that is not unattended.
    await launchDazSceneless('visible')
  }
  return { romPath: romAnimationPath(scene), dazWasRunning, startedAt }
}

/**
 * The project-scan run's `characterId` on the shared export watch — a
 * **sentinel**, because the batch spans every character of a project (or none
 * at all, on a base-only run) and so belongs to no single one. Consumed only by
 * the caller passing it as its `watcher` to {@link fetchExportRunProgress} (the
 * Tools panel); character editors are served the display-only `''` adoption
 * instead, so no editor's mount/focus refresh can eat (or clobber) the run.
 */
