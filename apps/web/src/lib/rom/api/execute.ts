import { exists, readTextFile, remove, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import {
  EXECUTE_STAMPS_FILE,
  EXPORTER_JOB_FILE,
  EXPORT_MODES,
  RUNNING_JOB_FILE,
  executeSceneSignature,
  jobFileJson,
  jobSceneForMode,
  jobScriptForMode,
  normalizeSceneKey,
  openSceneJobFileJson,
  parseExecuteStamps,
  parseJobFileJson,
  romAnimationPath,
  sceneExportFolderRel,
} from '../execute-jobs'
import { BUILD_ROM_ANIMATION_SCRIPT, sceneExportName } from '@dth/rom'
import { normalizePathLower } from '#/lib/path.ts'
import { deriveScenesRootRel } from '#/lib/scene-subfolder.ts'
import { relativeInside } from '../storage/fs'
import { charScopeInput, charsRoot, dirname, joinPath, locateCharacter, resolveProject } from './core'

import type { ExecuteStamp, ExecuteStamps, ExporterJob } from '../execute-jobs'
import type { CharacterLocation } from '../storage'
import type { Character } from '@dth/rom'

// The DTH Export feature (job-file contract v2): hand the character's
// ROM+export runs to the DTH Character Studio Runner as a JSON job file in
// the Daz library, starting Daz Studio when it isn't running. The Runner
// polls for the file (startup + regularly, so a running instance accepts new
// batches), RENAMES it (`running_` prefix — the "started" signal; only an
// un-renamed file can still be aborted by deletion), then works through the
// rows while updating the file's `progress` + per-job statuses. The studio
// polls the renamed file, deletes it at progress 100 and toasts the outcome.
// Contract: docs/exporter-plugin-job-file.md. The pure parts (JSON text,
// signatures) live in ../execute-jobs.ts. The scene choice is the export
// DIALOG's (the studio pre-checks the affected scenes via
// fetchExecuteScenes); this module takes the chosen list verbatim.

/** Resolve the character + its on-disk location for either entry point. */
async function loadCharacter(
  projectId: string,
  id: string,
): Promise<{
  project: Awaited<ReturnType<typeof resolveProject>>
  location: CharacterLocation
  character: Character
}> {
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, id)
  const character = location ? await storage.getCharacter(lib, id, location.definitionAbs) : null
  if (!location || !character) throw new Error(`Character ${id} not found`)
  return { project, location, character }
}

/**
 * The character's scenes ROOT — the folder each scene's export subfolder is
 * derived below (the same rule generation feeds `sceneExportSubfolders`, so
 * both compute the same export paths). Undefined when the primary lives
 * outside the character folder: the subfolder then falls back to the scene
 * stem, exactly like the runtime.
 */
export function characterScenesRoot(
  character: Character,
  location: CharacterLocation,
  dazSubdir: string,
): string | undefined {
  if (!character.scenePath) return undefined
  const charFolder = location.folderAbs
  const primaryDir = dirname(character.scenePath)
  const primaryRel =
    normalizePathLower(primaryDir) === normalizePathLower(charFolder)
      ? ''
      : relativeInside(charFolder, primaryDir)
  if (primaryRel === null) return undefined
  const rootRel = deriveScenesRootRel(primaryRel, dazSubdir)
  return rootRel ? joinPath(charFolder, rootRel) : charFolder
}

/** Read a character's stored handoff stamps (missing/corrupt = empty). */
async function readStamps(location: CharacterLocation): Promise<ExecuteStamps> {
  const stampsPath = joinPath(location.folderAbs, EXECUTE_STAMPS_FILE)
  try {
    if (await exists(stampsPath)) return parseExecuteStamps(await readTextFile(stampsPath))
  } catch {
    // unreadable stamps = no stamps — worst case a scene re-runs needlessly
  }
  return { version: 1, scenes: {} }
}

/** Absolute paths of the (one, global) job file pair — the pending file the
 *  studio writes and the `running_` one the Runner renames it to. Null when
 *  the desktop app / Daz library aren't available. */
async function exporterJobFilePaths(): Promise<{ pending: string; running: string } | null> {
  if (!isTauri()) return null
  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) return null
  const dir = storage.studioScriptsDir(settings.dazLibraryFolder)
  return { pending: joinPath(dir, EXPORTER_JOB_FILE), running: joinPath(dir, RUNNING_JOB_FILE) }
}

/**
 * Whether a job file is currently waiting for Daz Studio to pick it up. Drives
 * the header button's Abort state — the Runner RENAMES the file when it starts
 * (contract v2), so "the un-renamed file exists" IS "pending / abortable".
 * Best-effort false on any read problem.
 */
export async function exporterJobsPending(): Promise<boolean> {
  const paths = await exporterJobFilePaths()
  if (!paths) return false
  try {
    return await exists(paths.pending)
  } catch {
    return false
  }
}

/** How long to wait for the Runner to claim an `open-scene` handoff, and how
 *  often to look. The plugin polls "every few seconds", so this has to cover a
 *  full poll interval plus slack — but it is also a user waiting on a click, so
 *  it can't be generous. ~10s: long enough that a working Runner always wins,
 *  short enough that the fallback dialog doesn't feel hung. */
const OPEN_SCENE_PICKUP_TIMEOUT_MS = 10_000
const OPEN_SCENE_POLL_MS = 400

/**
 * Ask a RUNNING Daz Studio to open `scenePath`, via the Runner's `open-scene`
 * job (contract v3 — docs/exporter-plugin-job-file.md). Daz drops a forwarded
 * command-line open once a scene is loaded, so this is the only way to switch
 * the scene of an instance that is already up; the Runner also raises the Daz
 * window, which the studio can't do from outside (Windows blocks
 * SetForegroundWindow for a background process).
 *
 * Returns whether the Runner CLAIMED the job — the caller falls back to the
 * "Daz is already open" dialog when it didn't. Non-pickup is the expected path
 * on an old or missing Runner: an unknown `type` is foreign to it, so it leaves
 * the file alone and we take it back. That is the whole capability handshake;
 * there is no version check.
 *
 * Claimed only means the Runner started — the scene load itself happens after
 * we return (a big `.duf` takes a while, and blocking the click on it would be
 * worse than useless). A detached watcher deletes the finished `running_` file
 * ({@link sweepFinishedOpenScene}); one that outlives the window is swept by
 * the next handoff.
 */
/**
 * Detached completion sweep for a CLAIMED open-scene handoff: the contract has
 * the STUDIO delete the finished file, and nothing else watches this batch
 * kind — without the sweep the done `running_` file sits as litter until the
 * next handoff. Export batches are never touched (their own watch deletes at
 * 100); a Runner cancel (v1.1.3 Save Changes prompt) deletes the file itself,
 * which simply ends this watch early.
 */
function sweepFinishedOpenScene(runningPath: string): void {
  void (async () => {
    const deadline = Date.now() + 10 * 60_000
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      try {
        if (!(await exists(runningPath))) return // cancelled in Daz, or already swept
        const parsed = parseJobFileJson(await readTextFile(runningPath))
        if (!parsed) continue // torn rewrite — retry next tick
        if (parsed.type !== 'open-scene') return // a newer batch took the slot over
        if (parsed.progress >= 100) {
          await remove(runningPath).catch(() => {})
          return
        }
      } catch {
        // transient fs error — retry next tick
      }
    }
  })()
}

export async function openSceneInRunningDaz({
  data,
}: {
  data: unknown
}): Promise<{ pickedUp: boolean }> {
  const { scenePath } = z.object({ scenePath: z.string().min(1) }).parse(data)
  if (!isTauri()) throw new Error('Opening a scene in a running Daz needs the desktop app.')
  const paths = await exporterJobFilePaths()
  if (!paths) {
    throw new Error('Set “My DAZ 3D Library” in Settings first — the job file lives there.')
  }
  if (!(await exists(scenePath))) throw new Error(`The scene file is missing:\n${scenePath}`)
  // One global job file, and the Runner works one batch at a time: never
  // overwrite an export handoff with a scene open.
  if (await exists(paths.pending)) {
    throw new Error('An export batch is waiting for Daz Studio — let it start (or abort it) first.')
  }
  if (await exists(paths.running)) {
    // A batch in flight owns the Runner; a FINISHED one (progress 100) is just
    // litter nobody swept, so clear that and continue.
    const finished = await readTextFile(paths.running)
      .then((text) => parseJobFileJson(text)?.progress === 100)
      // Unreadable or torn: assume a live batch — refusing is the safe guess.
      .catch(() => false)
    if (!finished) {
      throw new Error('Daz Studio is working through an export batch — try again when it finishes.')
    }
    await remove(paths.running).catch(() => {})
  }

  await storage.writeTextFileAtomic(paths.pending, openSceneJobFileJson(scenePath))
  const deadline = Date.now() + OPEN_SCENE_PICKUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, OPEN_SCENE_POLL_MS))
    // The rename IS the claim (contract v2 lifecycle, shared by every type).
    if (!(await exists(paths.pending).catch(() => true))) {
      sweepFinishedOpenScene(paths.running)
      // The Runner raises the Daz window itself, but Windows usually DENIES
      // that (only the foreground process may hand focus over) — so the
      // studio, which holds that right at click time, pulls Daz forward the
      // moment the handoff is claimed (same helper as the Explorer-open flow).
      void invoke('focus_app_window', { exeNames: ['DAZStudio.exe'] }).catch(() => {})
      return { pickedUp: true }
    }
  }
  // Nobody claimed it — take the file back so it can't be picked up minutes
  // later, out of nowhere, and yank the user's scene out from under them.
  await remove(paths.pending).catch(() => {})
  return { pickedUp: false }
}

/**
 * The handed-off run, kept IN MEMORY until it finishes or is aborted/dismissed
 * — it scopes the job file's global state to the character whose button
 * started it. All actual progress lives IN the (renamed) job file, written by
 * the Runner. Per-window state (one run at a time; a new handoff replaces
 * it), gone on a window close — a finished `running_` file nobody watched is
 * cleaned up by the next handoff.
 */
interface ActiveExportRun {
  characterId: string
  total: number
  /** Linked Houdini project (`.hip`) to open once the batch finishes — the
   *  dialog's "Open Houdini project after export" pick ('' = none). */
  openHoudiniProject: string
  /** The dialog's "Export too" toggle: run that project's DazToHue exports
   *  after opening it, instead of just opening it (see api/houdini.ts). */
  houdiniExport: boolean
  /** The scenes this batch ran, in job order — the Houdini run exports only
   *  the networks importing THESE scenes, so the list has to survive the batch
   *  to be available when it finishes. */
  scenes: Array<string>
}
let activeRun: ActiveExportRun | null = null

export type ExportRunProgress =
  /** Daz hasn't picked the file up yet (it can still be aborted). */
  | { state: 'pending'; characterId: string; total: number }
  /** The Runner renamed the file and is working. `processed` = rows already
   *  worked (done + failed; the Runner-written `jobsDone` when present) — what
   *  the button shows as "Exporting 1/2". `progress` (0–100) stays the finish
   *  signal only. */
  | {
      state: 'running'
      characterId: string
      total: number
      progress: number
      processed: number
      done: number
      failed: number
    }
  /** progress hit 100 — the studio has DELETED the file; final snapshot. */
  | {
      state: 'finished'
      characterId: string
      total: number
      failed: number
      errors: Array<string>
      /** The run's after-export Houdini project ('' = none picked). */
      openHoudiniProject: string
      /** Whether that project should also RUN its exports ("Export too"). */
      houdiniExport: boolean
      /** The scenes the batch ran — the Houdini job's scope. */
      scenes: Array<string>
    }
  /** The run died (Daz gone mid-run / file vanished) — watch ended. */
  | { state: 'dead'; characterId: string; total: number }

/**
 * The active run's live state (null when none), straight from the job-file
 * pair: pending file still there → 'pending'; `running_` file there → parse
 * its Runner-owned progress — at 100 the studio deletes the file and returns
 * the one 'finished' snapshot (the caller toasts the outcome). A running file
 * whose Daz has EXITED below 100 is a dead run: deleted + reported 'dead'
 * once. A torn read (the Runner rewrites the file between rows) just reports
 * the last state again — the next poll gets a clean parse.
 *
 * The finished/dead handling is DESTRUCTIVE — it deletes the file, drops the
 * watch and returns the ONE outcome snapshot — so it must reach the caller
 * that OWNS the run, not whichever poll lands first. `watcher` is the caller's
 * identity on the watch: sentinel runs ({@link GENESIS_INDEX_RUN}) are only
 * consumed by the caller passing that sentinel (the Tools panel), and that
 * caller in turn never consumes a character run. Every mismatched watcher/run
 * pairing — an editor's mount/focus refresh during an index build, the Tools
 * panel polling during an export — is served the display-only `''` adoption
 * instead, exactly like a foreign window's batch. Character editors pass
 * nothing (their runs predate the parameter and stay first-poll-consumed —
 * within one window only one editor is mounted at a time).
 */
export async function fetchExportRunProgress(watcher?: string): Promise<ExportRunProgress | null> {
  const run = activeRun
  const paths = await exporterJobFilePaths()
  if (!paths) return null
  // Sentinel runs belong to their own panel — see the doc comment above.
  const foreignToWatcher =
    run !== null &&
    (run.characterId === GENESIS_INDEX_RUN
      ? watcher !== GENESIS_INDEX_RUN
      : watcher === GENESIS_INDEX_RUN)
  if (!run || foreignToWatcher) {
    // No in-memory watch — a scene-card ROM-animation generate (which arms
    // none), another window's run, or a reloaded window — or a live watch
    // this CALLER must not consume (`foreignToWatcher`). The Runner is ONE
    // global resource, so a live batch should still show on the button:
    // adopt it for DISPLAY only (`characterId: ''` — every editor may show
    // it, none toasts an outcome). A finished/foreign file is left alone —
    // its owner (or the next handoff's sweep) cleans up.
    try {
      if (!(await exists(paths.running))) return null
      const parsed = parseJobFileJson(await readTextFile(paths.running))
      if (!parsed || parsed.type !== 'bulk-export' || parsed.progress >= 100) return null
      const done = parsed.jobs.filter((j) => j.status === 'done').length
      const failed = parsed.jobs.filter((j) => j.status === 'failed').length
      return {
        state: 'running',
        characterId: '',
        total: parsed.jobs.length,
        progress: parsed.progress,
        processed: parsed.jobsDone ?? done + failed,
        done,
        failed,
      }
    } catch {
      return null
    }
  }
  try {
    if (await exists(paths.pending)) {
      return { state: 'pending', characterId: run.characterId, total: run.total }
    }
    if (await exists(paths.running)) {
      const parsed = parseJobFileJson(await readTextFile(paths.running))
      if (!parsed) {
        // Torn read mid-rewrite — report "still running" and retry next poll.
        return {
          state: 'running',
          characterId: run.characterId,
          total: run.total,
          progress: 0,
          processed: 0,
          done: 0,
          failed: 0,
        }
      }
      const done = parsed.jobs.filter((j) => j.status === 'done').length
      const failed = parsed.jobs.filter((j) => j.status === 'failed').length
      if (parsed.progress >= 100) {
        // The batch is complete — the studio owns the cleanup + the toast.
        try {
          await remove(paths.running)
        } catch {
          // locked file — the next handoff's stale-cleanup retries
        }
        if (activeRun === run) activeRun = null
        return {
          state: 'finished',
          characterId: run.characterId,
          total: parsed.jobs.length || run.total,
          failed,
          errors: parsed.jobs
            .filter((j) => j.error)
            // An empty scenePath (the contract's "new empty scene" row, e.g.
            // the genesis-index build) would prefix the line with a bare ": ".
            .map((j) => (j.scenePath ? `${j.scenePath}: ${j.error ?? ''}` : (j.error ?? ''))),
          openHoudiniProject: run.openHoudiniProject,
          houdiniExport: run.houdiniExport,
          scenes: run.scenes,
        }
      }
      // Below 100 with Daz gone = the run died (crash / user quit) — it will
      // never finish; clean up and report once.
      const dazRunning = await invoke<boolean>('daz_studio_running').catch(() => true)
      if (!dazRunning) {
        try {
          await remove(paths.running)
        } catch {
          // best effort
        }
        if (activeRun === run) activeRun = null
        return { state: 'dead', characterId: run.characterId, total: run.total }
      }
      return {
        state: 'running',
        characterId: run.characterId,
        total: parsed.jobs.length || run.total,
        progress: parsed.progress,
        processed: parsed.jobsDone ?? done + failed,
        done,
        failed,
      }
    }
  } catch {
    // transient fs error — keep the watch alive, retry next poll
    return { state: 'pending', characterId: run.characterId, total: run.total }
  }
  // Neither file exists: aborted externally or cleaned behind our back.
  if (activeRun === run) activeRun = null
  return { state: 'dead', characterId: run.characterId, total: run.total }
}

/** Stop watching the active run (the run in Daz is unaffected — the watch is
 *  an observer only). The escape hatch for a batch that errored in Daz and
 *  will never deliver its remaining scenes. */
export function dismissExportRun(): void {
  activeRun = null
}

/**
 * Abort a pending handoff: delete the job file before Daz consumes it, and roll
 * the aborted scenes' handoff stamps back on THIS character (they were stamped
 * at handoff; without the rollback they'd read "unchanged" in the next dialog
 * despite never having run). Rows belonging to another character's handoff
 * simply don't match this character's stamp keys — the file still goes away,
 * which is what Abort promises.
 */
export async function abortExporterJobs({ data }: { data: unknown }): Promise<void> {
  const { projectId, id } = charScopeInput.parse(data)
  const paths = await exporterJobFilePaths()
  if (!paths) return
  let rows: Array<ExporterJob> = []
  try {
    if (!(await exists(paths.pending))) return
    rows = parseJobFileJson(await readTextFile(paths.pending))?.jobs ?? []
  } catch {
    // unreadable job file — still delete it below; stamps stay (worst case a
    // scene reads "unchanged" until its next real change or a manual re-check)
  }
  await remove(paths.pending)
  // The aborted handoff will never run — stop the export watch with it.
  activeRun = null
  if (rows.length === 0) return
  try {
    const { location } = await loadCharacter(projectId, id)
    const stored = await readStamps(location)
    const aborted = new Set(rows.map((row) => normalizeSceneKey(row.scenePath)))
    const scenes = Object.fromEntries(
      Object.entries(stored.scenes).filter(([key]) => !aborted.has(key)),
    )
    await storage.writeTextFileAtomic(
      joinPath(location.folderAbs, EXECUTE_STAMPS_FILE),
      JSON.stringify({ version: 1, scenes }, null, 2),
    )
  } catch {
    // stamp rollback is best-effort — the abort itself (the delete) succeeded
  }
}

/** One linked scene's state for the DTH Export dialog. */
export interface ExecuteSceneStatus {
  scenePath: string
  primary: boolean
  /** Inputs changed since the last handoff (or never handed off) — the dialog's
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
}

/**
 * Every linked scene with its affected-state + saved-ROM state — what the DTH
 * Export dialog pre-checks (per mode). Per-scene tolerant: an unreadable `.duf`
 * reports `missing` instead of throwing (the dialog disables that row).
 */
export async function fetchExecuteScenes({ data }: { data: unknown }): Promise<Array<ExecuteSceneStatus>> {
  const { projectId, id } = charScopeInput.parse(data)
  if (!isTauri()) return []
  const { project, location, character } = await loadCharacter(projectId, id)
  const stored = await readStamps(location)
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
      }
    }),
  )
}

const executeInput = charScopeInput.extend({
  /** The scenes to enqueue, chosen in the DTH Export dialog — each must be one
   *  of the character's linked scenes. */
  scenes: z.array(z.string().min(1)).min(1),
  /** What the run does — the dialog's first step. Defaults to the full
   *  ROM + export run (see {@link ExportMode}). */
  mode: z.enum(EXPORT_MODES).default('rom-export'),
  /** Linked Houdini project to open once the batch FINISHES (the dialog's
   *  optional pick); omitted/empty = open nothing. */
  openHoudiniProject: z.string().optional(),
  /** "Export too": after opening that project, run its DazToHue exports for the
   *  networks importing these scenes. Ignored without a project pick — there is
   *  nothing to run then. Off by default: it drives the user's own Houdini. */
  houdiniExport: z.boolean().default(false),
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
async function currentStamp(character: Character, scenePath: string): Promise<ExecuteStamp> {
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
    openHoudiniProject,
    houdiniExport,
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

  // The after-export Houdini project must be one of the character's LINKED
  // projects (the dialog only offers those; backstop against a stale pick).
  const openHoudini = openHoudiniProject?.trim()
    ? character.houdiniProjects.find(
        (p) => normalizeSceneKey(p) === normalizeSceneKey(openHoudiniProject),
      )
    : undefined
  if (openHoudiniProject?.trim() && !openHoudini) {
    throw new Error(
      `The Houdini project is not linked to this character anymore:\n${openHoudiniProject}`,
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
    jobs.push({ scenePath: jobScene, scriptPath })
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
      const dazRunning = await invoke<boolean>('daz_studio_running').catch(() => true)
      if (dazRunning) {
        throw new Error('Daz Studio is working through a batch — try again when it finishes.')
      }
      // Daz gone below 100 = a dead run; fall through and clean it up.
    }
    await remove(staleRunning).catch(() => {
      // best effort — the Runner also clears a stale running file before renaming
    })
  }
  await storage.writeTextFileAtomic(jobFile, jobFileJson(jobs))

  // Arm the watch: the run's identity only — all live state (progress,
  // per-job statuses) is Runner-owned inside the renamed job file.
  activeRun = {
    characterId: character.id,
    total: jobs.length,
    openHoudiniProject: openHoudini ?? '',
    // Without a project there is nothing to run the exports in, so the toggle
    // cannot mean anything on its own.
    houdiniExport: houdiniExport && !!openHoudini,
    scenes,
  }

  // Stamp the handoff (merge — untouched scenes keep their stamps), but ONLY
  // for the full run: a stamp claims "this definition, as it stands, has been
  // exported". A ROM-only run exports nothing, and an export-only run ships
  // whatever the saved ROM holds — which may predate the current definition.
  // Stamping either would make the dialog report scenes as up to date when
  // their current inputs never reached Houdini.
  if (mode === 'rom-export') {
    const stored = await readStamps(location)
    const nextStamps: ExecuteStamps = { version: 1, scenes: { ...stored.scenes } }
    for (const scene of scenes) {
      const stamp = stamps.get(scene)
      if (stamp) nextStamps.scenes[normalizeSceneKey(scene)] = stamp
    }
    await storage.writeTextFileAtomic(
      joinPath(location.folderAbs, EXECUTE_STAMPS_FILE),
      JSON.stringify(nextStamps, null, 2),
    )
  }

  // Start Daz scene-less when it isn't running; a running instance needs
  // nothing — the plugin polls for the job file and picks it up in place.
  const dazWasRunning = await invoke<boolean>('daz_studio_running').catch(() => false)
  let dazLaunched = false
  let dazClosing = false
  if (!dazWasRunning) {
    await invoke<string>('launch_daz_studio')
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
  if (!(await exists(paths.pending).catch(() => false))) return false
  if (await invoke<boolean>('daz_studio_running').catch(() => false)) return true
  await invoke<string>('launch_daz_studio')
  return true
}

const generateRomInput = charScopeInput.extend({
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
  await storage.writeTextFileAtomic(paths.pending, jobFileJson([{ scenePath: scene, scriptPath }]))
  const startedAt = Date.now()
  const dazWasRunning = await invoke<boolean>('daz_studio_running').catch(() => false)
  if (!dazWasRunning) await invoke<string>('launch_daz_studio')
  return { romPath: romAnimationPath(scene), dazWasRunning, startedAt }
}

/**
 * The Genesis-index run's `characterId` on the shared export watch — a sentinel,
 * because this batch belongs to no character. Only the caller passing it as its
 * `watcher` to {@link fetchExportRunProgress} (the Tools panel) may consume the
 * run's outcome; character editors are served the display-only `''` adoption
 * instead, so no editor's mount/focus refresh can eat (or clobber) the run.
 */
export const GENESIS_INDEX_RUN = '#genesis-index'

/**
 * Hand a **Build Genesis Index** run to the Runner: a one-row bulk-export batch
 * on the visible root-level `Build_Genesis_Index.dsa`, with an **empty
 * `scenePath`** — the contract's "run this script in a NEW EMPTY scene the
 * plugin creates" (docs/exporter-plugin-job-file.md), which is exactly right
 * here: the script builds every generation's stock figures itself and needs no
 * scene, and an empty one is what keeps whatever the user had open out of the
 * scan.
 *
 * Same handoff mechanics as every other batch — one global job file, refuse
 * while another is live, clear a finished-but-unswept `running_`, start Daz when
 * it's closed. The watch is armed so the panel can show progress and report the
 * outcome once. When Daz was already "running", the same ~10s claim-wait as
 * {@link executeCharacterJobs} guards against handing the batch to nobody: a
 * running process whose Runner never renames the file is most likely SHUTTING
 * DOWN (or running without the Runner plugin) — the handoff is taken back
 * (file deleted, watch dropped) and reported as an error rather than left as a
 * forever-pending spinner.
 */
export async function buildGenesisIndex(): Promise<{ dazWasRunning: boolean }> {
  if (!isTauri()) throw new Error('Building the Genesis index needs the desktop app.')
  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) {
    throw new Error('Set “My DAZ 3D Library” in Settings first — the job file and the script live there.')
  }
  const scriptPath = joinPath(
    storage.studioScriptsDir(settings.dazLibraryFolder),
    storage.GENESIS_INDEX_SCRIPT,
  )
  if (!(await exists(scriptPath))) {
    throw new Error(
      `The index script is not installed:\n${scriptPath}\nRun Tools → Refresh assets to install it, then try again.`,
    )
  }
  const paths = await exporterJobFilePaths()
  if (!paths) throw new Error('Set “My DAZ 3D Library” in Settings first.')
  if (await exists(paths.pending)) {
    throw new Error('A batch is already waiting for Daz Studio — let it start (or abort it) first.')
  }
  if (await exists(paths.running)) {
    const finished = await readTextFile(paths.running)
      .then((text) => parseJobFileJson(text)?.progress === 100)
      // Unreadable or torn: assume a live batch — refusing is the safe guess.
      .catch(() => false)
    if (!finished) {
      throw new Error('Daz Studio is working through a batch — try again when it finishes.')
    }
    await remove(paths.running).catch(() => {})
  }
  await storage.writeTextFileAtomic(paths.pending, jobFileJson([{ scenePath: '', scriptPath }]))
  activeRun = {
    characterId: GENESIS_INDEX_RUN,
    total: 1,
    openHoudiniProject: '',
    houdiniExport: false,
    scenes: [],
  }
  const dazWasRunning = await invoke<boolean>('daz_studio_running').catch(() => false)
  if (!dazWasRunning) {
    // A fresh launch claims the file on startup — no wait (Daz can take long
    // to come up; the panel's pending state covers it, with Abort as the out).
    await invoke<string>('launch_daz_studio')
    return { dazWasRunning }
  }
  // A "running" Daz may be SHUTTING DOWN (the process lingers, its Runner
  // poller is already gone) — or running without the Runner. A live Runner
  // claims (renames) the file within one poll interval; when the claim never
  // comes, take the handoff back so it can't sit pending forever (or fire
  // minutes later out of nowhere) and say what to do instead.
  const deadline = Date.now() + OPEN_SCENE_PICKUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, OPEN_SCENE_POLL_MS))
    if (!(await exists(paths.pending).catch(() => true))) return { dazWasRunning }
  }
  // Take back only OUR handoff: a replacement batch written meanwhile owns
  // both the pending file and the watch (activeRun) — leave those alone.
  if (activeRun?.characterId === GENESIS_INDEX_RUN) {
    activeRun = null
    await remove(paths.pending).catch(() => {})
  }
  throw new Error(
    'Daz Studio never picked the job up — it is most likely still shutting down (or the Runner plugin is not running). The handoff was taken back; wait for Daz Studio to close fully, then try again.',
  )
}

/**
 * Abort a genesis-index handoff still WAITING for Daz Studio (the un-renamed
 * job file): delete the file and drop the watch — the Tools panel's way out of
 * the pending state. No handoff stamps to roll back ({@link abortExporterJobs}
 * does that for character runs) — this batch belongs to no character. A file
 * the Runner already claimed (renamed) is left alone; the watch still ends,
 * the same "stop watching, the run in Daz is unaffected" promise as
 * {@link dismissExportRun}.
 */
export async function abortGenesisIndexRun(): Promise<void> {
  if (activeRun?.characterId !== GENESIS_INDEX_RUN) return
  const paths = await exporterJobFilePaths()
  if (paths) await remove(paths.pending).catch(() => {})
  activeRun = null
}

/** A file's mtime in ms, or 0 when it doesn't exist / can't be stat'ed. */
async function mtimeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).mtime?.getTime() ?? 0
  } catch {
    return 0
  }
}

/** One scene's saved ROM animation — what the scene card's open menu offers. */
export interface RomAnimationStatus {
  scenePath: string
  /** Where the saved ROM animation lives (whether or not it exists). */
  romPath: string
  /** A `rom-animations/<stem>_ROM.duf` exists for this scene. */
  exists: boolean
  /**
   * …and was built from the CURRENT inputs: its mtime is at/after both the
   * source `.duf` and the character's generated ROM script (rewritten on every
   * save, so it dates the definition the ROM would be built from now). Stale ⇒
   * the card offers "Open and Generate" instead of opening a ROM that no
   * longer matches the definition.
   */
  current: boolean
}

/**
 * Every linked scene's saved-ROM-animation state, derived from the FILES alone
 * — no stamps, so it re-reads correctly on every window focus.
 *
 * This deliberately does NOT use the export-handoff stamps
 * ({@link fetchExecuteScenes}'s `affected`): those record the last EXPORT, an
 * unrelated event. A ROM-animation build writes no stamp, so a freshly built
 * animation still read "affected" (stale) forever — and a character that never
 * exported had every scene stale from the start.
 */
export async function fetchRomAnimations({
  data,
}: {
  data: unknown
}): Promise<Array<RomAnimationStatus>> {
  const { projectId, id } = charScopeInput.parse(data)
  if (!isTauri()) return []
  const { project, character } = await loadCharacter(projectId, id)
  const settings = await storage.getSettings()
  // The generated ROM-only script IS the compiled ROM inputs — its mtime dates
  // the definition. Missing library/script (never generated) ⇒ 0, i.e. only the
  // scene file gates freshness.
  const scriptMtime = settings.dazLibraryFolder
    ? await mtimeOf(
        joinPath(
          storage.studioCharScriptsDir(settings.dazLibraryFolder, project.name, character.name),
          BUILD_ROM_ANIMATION_SCRIPT,
        ),
      )
    : 0
  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  return Promise.all(
    linked.map(async (scenePath) => {
      const romPath = romAnimationPath(scenePath)
      const romMtime = await mtimeOf(romPath)
      if (romMtime === 0) return { scenePath, romPath, exists: false, current: false }
      const sceneMtime = await mtimeOf(scenePath)
      return {
        scenePath,
        romPath,
        exists: true,
        current: romMtime >= sceneMtime && romMtime >= scriptMtime,
      }
    }),
  )
}

/**
 * Whether the saved ROM animation at `romPath` is FRESH — written at/after
 * `sinceMs`. The generate flow polls this instead of bare existence, because a
 * regenerate OVERWRITES an existing file: only a new mtime means the Daz run
 * saved. Best-effort false (missing file, unreadable stat).
 */
export async function romAnimationFresh({ data }: { data: unknown }): Promise<boolean> {
  const { romPath, sinceMs } = z
    .object({ romPath: z.string().min(1), sinceMs: z.number() })
    .parse(data)
  if (!isTauri()) return false
  try {
    const info = await stat(romPath)
    return (info.mtime?.getTime() ?? 0) >= sinceMs
  } catch {
    return false
  }
}
