import { exists, mkdir, readTextFile, remove, rename, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import {
  EXECUTE_STAMPS_FILE,
  EXPORTER_JOB_FILE,
  EXPORT_MODES,
  EXPORT_PROGRESS_FILE,
  HOUDINI_RUN_MODES,
  RUNNING_JOB_FILE,
  SCAN_CONFIG_FILE,
  executeSceneSignature,
  exportProgressStateFrom,
  jobFileJson,
  isReclaimableBatch,
  jobFileMayBeLive,
  jobSceneForMode,
  jobScriptForMode,
  jobStepsForMode,
  normalizeSceneKey,
  openSceneJobFileJson,
  parseExecuteStamps,
  parseExportProgressLog,
  parseJobFileJson,
  romAnimationPath,
  scanConfigJson,
  sceneExportFolderRel,
} from '../execute-jobs'
import { BUILD_ROM_ANIMATION_SCRIPT, cancelFlagPath, sceneExportName } from '@dth/rom'
import { sceneDthPath } from '../houdini-jobs'
import {
  SCAN_RUN_SCRIPT,
  parseScanResult,
  scanCsvPath,
  scanResultPath,
  scanRunScript,
} from '../scan-run.ts'
import { normalizePathLower } from '#/lib/path.ts'
import { deriveScenesRootRel } from '#/lib/scene-subfolder.ts'
import { relativeInside } from '../storage/fs'
import {
  charScopeInput,
  charsRoot,
  dirname,
  joinPath,
  locateCharacter,
  projectIdInput,
  resolveProject,
  exportDazInstallFolder,
} from './core'
import type { ProjectInfo } from './core'

import type {
  ExecuteStamp,
  ExecuteStamps,
  ExporterJob,
  ExporterJobType,
  ExportMode,
  ExportProgressState,
  HoudiniRunMode,
  JobFileKind,
  ScanProductsConfig,
  ScanSceneWork,
} from '../execute-jobs'
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

/** Where a character's handoff stamps live: its folder in the project's meta
 *  folder, alongside the run log and the generated PoseAsset CSV. */
function stampsPath(project: ProjectInfo, location: CharacterLocation, id: string): string {
  return joinPath(
    storage.characterMetaDir(project.path, location.relFolder, id),
    EXECUTE_STAMPS_FILE,
  )
}

/** Read a character's stored handoff stamps (missing/corrupt = empty). */
async function readStamps(path: string): Promise<ExecuteStamps> {
  try {
    if (await exists(path)) return parseExecuteStamps(await readTextFile(path))
  } catch {
    // unreadable stamps = no stamps — worst case a scene re-runs needlessly
  }
  return { version: 1, scenes: {} }
}

/** Replace a character's handoff stamps, creating the meta folder if a character
 *  reaches DTH Export before anything else has written there. */
async function writeStamps(path: string, stamps: ExecuteStamps): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await storage.writeTextFileAtomic(path, JSON.stringify(stamps, null, 2))
}

/**
 * WHICH Daz a running-check is about — the same question has two right answers
 * here, and they are not interchangeable.
 *
 * - `'export'` — only the installation that runs export batches (the
 *   **Export only** one, else the active one). What a LAUNCH decision needs:
 *   with "Export only" pointing at an older install, asking globally let an open
 *   DS6 answer "Daz is already running, nothing to start", so the DS4 the batch
 *   was for never launched and the job file sat pending and unclaimed forever.
 *   Being wrong the other way here costs one redundant launch, which a running
 *   Daz collapses into itself.
 * - `'any'` — any Daz at all, the pre-existing meaning. What the two
 *   DESTRUCTIVE readings keep: "the run died, delete its file" and "that stale
 *   `running_` file is nobody's, overwrite it". Those act on "no Daz is
 *   running", so a probe that answers about ONE install can strand a live batch
 *   whenever the install folder and the running executable's path disagree
 *   (a moved/reinstalled Daz, a settings path never re-detected). Being wrong
 *   the other way just delays a cleanup — and Settings → App Data can now clear
 *   a job file by hand, which is the honest way out of the stuck case.
 */
type DazRunningScope = 'export' | 'any'

/**
 * `daz_studio_running` through the FFI ritual (a primitive return still goes
 * through a schema — see api/native-types.ts). `fallback` keeps each call site's
 * failure bias: "assume running" where clobbering a live batch is the risk,
 * "assume closed" where a needless launch is the risk. `scope` is stated at
 * every call site on purpose — see {@link DazRunningScope}; there is no default
 * that is right for both kinds of caller.
 */
async function dazStudioRunningNative(
  fallback: boolean,
  scope: DazRunningScope,
): Promise<boolean> {
  try {
    const installFolder = scope === 'export' ? await exportDazInstallFolder() : ''
    return z.boolean().parse(await invoke('daz_studio_running', { installFolder }))
  } catch {
    return fallback
  }
}

/**
 * Whether the installation that runs export batches is up — the wait-for-Daz-to-
 * close modal's poll ({@link launchDazForPendingJobs} is what it calls once this
 * goes false). Exported because that modal lives in the character UI, and asking
 * the unscoped "any Daz running?" there kept it spinning forever whenever the
 * export install was closed but ANOTHER Daz was open.
 *
 * Bias on failure: not running — the same one the modal has always had (it would
 * rather try a launch than wait on a probe it can't read).
 */
export async function exportDazStudioRunning(): Promise<boolean> {
  return dazStudioRunningNative(false, 'export')
}

/**
 * Whether a launched Daz may take over the screen.
 *
 * Stated at every call site on purpose — the same reasoning as
 * {@link DazRunningScope}, and there is no default that is right for both
 * kinds of caller:
 *
 * - `'minimized'` — UNATTENDED work: an export batch, a project or scene scan,
 *   the restart of a pending handoff. Nobody asked to look at Daz; it is the
 *   Runner's workbench, and everything handed to the Runner is dialog-free by
 *   construction precisely so it can run unwatched (`.ai/domain.md`).
 * - `'visible'` — the user asked for the SCENE. "Open and Generate ROM
 *   Animation" opens a scene from its card and leaves the built ROM on the
 *   timeline to be looked at; minimizing that hides the thing that was asked
 *   for. (It still doesn't grab focus — only a plain scene-card open does.)
 *
 * The other interactive path, opening a scene from its card, never comes
 * through here at all: it launches Daz WITH the scene as its argument
 * (`openSceneInActivatedDaz`, api/attachments.ts) or forwards a bridge script
 * to a running instance.
 */
type DazLaunchVisibility = 'minimized' | 'visible'

/** How long the native watch waits for a launched Daz to show its main window
 *  before dropping the minimize. Generous because a cold Daz with a large
 *  content library takes tens of seconds to paint one; the launch itself has
 *  already succeeded either way. */
const MINIMIZE_WINDOW_TIMEOUT_MS = 60_000

/** Start a scene-less Daz Studio (its Runner claims the pending job file on
 *  startup). The command returns the launched exe path — schema-parsed at the
 *  boundary like every native return, and what the minimize watch matches on.
 *
 *  The EXPORT install, not the active one: this is the launch that needs the
 *  Runner plugin, and "Export only" exists so a machine whose newest Studio has
 *  no Runner build yet can still export from the older one. With no card
 *  flagged the two resolve to the same folder. */
async function launchDazSceneless(visibility: DazLaunchVisibility): Promise<void> {
  const exePath = z.string().parse(
    await invoke('launch_daz_studio', {
      installFolder: await exportDazInstallFolder(),
      scenePath: '',
    }),
  )
  if (visibility !== 'minimized') return
  // Fire-and-forget: the native watch polls for Daz's main window for up to a
  // minute (a cold start is slow) and the handoff must not wait on it. Purely
  // best-effort — off Windows, or on a Daz that never shows a window, it just
  // does nothing and the launch stands on its own.
  //
  // Matched by the FULL path of the exe just launched, never a bare name: DS4
  // and DS6 are both `DAZStudio.exe`, and the launch decision is scoped to
  // the EXPORT install — so with another install open and visible, a name
  // match would find the USER'S window first (the launched Daz has none for
  // many seconds) and yank it down.
  void invoke('minimize_app_window', {
    exePaths: [exePath],
    timeoutMs: MINIMIZE_WINDOW_TIMEOUT_MS,
  }).catch(() => {})
}

/**
 * TOCTOU backstop for the single global job file: every handoff writer guards
 * with "refuse while a pending file exists", but two windows can both pass that
 * check and the second write then silently clobbers the first's live handoff.
 * One cheap read-back right after writing decides who actually owns the file —
 * the write is atomic (write-then-rename), so the read sees one whole file, and
 * the content identifies the batch (its scene/script paths and row order). The
 * loser throws the same "someone else's batch" refusal its exists-check would
 * have thrown a moment earlier. Two windows writing byte-identical batches
 * can't be told apart — and don't need to be: the batch on disk IS the one
 * either of them meant.
 */
async function assertHandoffOwned(pendingPath: string, written: string): Promise<void> {
  const onDisk = await readTextFile(pendingPath).catch(() => '')
  if (onDisk !== written) {
    throw new Error(
      'Another window handed Daz Studio a batch at the same moment — let it start (or abort it) first.',
    )
  }
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

/**
 * Whether the claimed (`running_`) batch shows REAL work — it parses and is
 * past the untouched state ({@link isReclaimableBatch}). The wait-for-close
 * modal uses it to stand down when a live Daz claims LATE (stuck on a modal
 * Save prompt past the pickup window, or restarted by hand): a batch being
 * worked belongs to the export watch, and a modal inviting the user to kill
 * Daz over it would cost finished scenes. A claimed-but-untouched batch
 * deliberately reads false — from the outside it is indistinguishable from
 * the closing-Daz claim the modal exists to rescue, so the modal keeps
 * waiting; the first row mark flips it. Best-effort false on any read problem.
 */
export async function exporterJobsWorking(): Promise<boolean> {
  const paths = await exporterJobFilePaths()
  if (!paths) return false
  try {
    if (!(await exists(paths.running))) return false
    const parsed = parseJobFileJson(await readTextFile(paths.running))
    return parsed !== null && !isReclaimableBatch(parsed)
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

  const jobJson = openSceneJobFileJson(scenePath)
  await storage.writeTextFileAtomic(paths.pending, jobJson)
  // Both windows can pass the exists-checks above — the read-back decides who
  // actually holds the handoff (see assertHandoffOwned).
  await assertHandoffOwned(paths.pending, jobJson)
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
  /** When THIS window wrote the handoff (`Date.now()`) — what the progress
   *  button's elapsed clock and the finish toast's total time count from.
   *  In-memory like the rest of the watch: a reloaded window (display-only
   *  adoption) doesn't know it, and simply shows no time. */
  startedAtMs: number
  /** The dialog's SELECTED Houdini projects (`.hip`), in list order — what the
   *  finish continuation works through once the batch is done ([] = none). */
  houdiniProjects: Array<string>
  /** What those projects do when their turn comes — the Houdini list's Mode
   *  dropdown (see {@link HoudiniRunMode}; api/houdini.ts runs the exports). */
  houdiniMode: HoudiniRunMode
  /** Linked `.uproject`s to hand the finished export to, once the Houdini
   *  queue behind this batch has drained ([] = none). Rides the whole run for
   *  the same reason the Houdini plan does: the send is minutes away. */
  unrealProjects: Array<string>
  /** The export sets to hand over — the dialog's tick list. */
  unrealSets: Array<string>
  /** The scenes this batch ran, in job order — the Houdini run exports only
   *  the networks importing THESE scenes, so the list has to survive the batch
   *  to be available when it finishes. */
  scenes: Array<string>
  /** What this batch DOES to each scene ({@link ExportMode}) — the Daz task
   *  cards' subtitle. Carried on the run rather than derived from the job rows
   *  because the rows only name a script path, and a window that reloaded
   *  mid-batch has nothing else left to read the choice off. */
  mode: ExportMode
  /** This run's interrupt flag ({@link EXPORT_CANCEL_FILE}) — recorded at the
   *  handoff so the watch can delete it wherever the run ends, without having
   *  to resolve the character's project all over again. '' for a run whose
   *  character has no meta folder (it then cannot be interrupted). */
  cancelPath: string
  /** The user asked this run to stop. The run keeps going until the scripts
   *  reach their next stop point — what changes HERE is the reporting: the
   *  batch is no longer allowed to continue into Houdini, and its outcome is
   *  reported as an interrupt, never as "n scenes exported" (the skipped rows
   *  come back `done`, because the Runner ran a script that chose to do
   *  nothing — believing those counts would be the lie this flag prevents). */
  interrupted?: boolean
}
let activeRun: ActiveExportRun | null = null

/**
 * The run-plan sidecar (app-data): everything the export watch would lose on
 * a window reload — the start time and the "Export too" continuation plan.
 * Written at every character handoff, deleted when the run ends however it
 * ends. A reloaded window whose EDITOR polls with the matching character id
 * RESTORES the full watch from it (ownership included: the finish report and
 * the Houdini continuation fire from the restored window), instead of the
 * display-only adoption every other window gets. Scoped to the character on
 * purpose: only one window can have a character open (single-instance routes
 * a second open into the existing window), so the restore cannot create two
 * owners.
 */
const EXPORT_RUN_FILE = 'export-run.json'

const exportRunSidecarSchema = z.object({
  characterId: z.string().min(1),
  total: z.number().int().nonnegative(),
  startedAtMs: z.number(),
  houdiniProjects: z.array(z.string()),
  houdiniMode: z.enum(HOUDINI_RUN_MODES),
  scenes: z.array(z.string()),
  unrealProjects: z.array(z.string()).default([]),
  unrealSets: z.array(z.string()).default([]),
  // Additive: a sidecar written before this field existed restores as the
  // default run, which is what the overwhelming majority of them were.
  mode: z.enum(EXPORT_MODES).default('rom-export'),
  // Defaulted, not required: a sidecar written by an older build carries
  // neither, and a restored watch must still restore.
  cancelPath: z.string().default(''),
  interrupted: z.boolean().default(false),
})

/**
 * Every sidecar write/delete queues on ONE chain, so they land in call order.
 * {@link dismissExportRun} is synchronous for its UI callers, which ignore
 * its promise — so without this chain a clear scheduled by an abort could
 * still be in flight when the user immediately starts the next export, and
 * would then delete the NEW run's sidecar (silently costing that run its
 * reload survival). Serialising makes "last call wins" true. Reads join the
 * same queue, so a poll can never see a sidecar a dismiss already retired.
 */
let sidecarChain: Promise<void> = Promise.resolve()
function queueSidecar(op: () => Promise<void>): Promise<void> {
  sidecarChain = sidecarChain.then(op, op)
  return sidecarChain
}

/** Best-effort — a failed write only degrades a later reload to the
 *  display-only adoption. */
function writeExportRunSidecar(run: ActiveExportRun): Promise<void> {
  return queueSidecar(async () => {
    try {
      await storage.writeTextFileAtomic(
        await storage.dataPath(EXPORT_RUN_FILE),
        JSON.stringify(run),
      )
    } catch {
      // best effort
    }
  })
}

function clearExportRunSidecar(): Promise<void> {
  return queueSidecar(async () => {
    try {
      await remove(await storage.dataPath(EXPORT_RUN_FILE))
    } catch {
      // best effort — overwritten by the next handoff either way
    }
  })
}

/** Reads through the same chain as the writes: a poll that lands right after
 *  a dismiss must see the CLEARED sidecar, or it would restore the very watch
 *  the user just dropped. */
async function readExportRunSidecar(): Promise<ActiveExportRun | null> {
  try {
    // Inside the try on purpose: every queued op swallows its own errors, so
    // the chain cannot reject — but a poll must not be able to throw over the
    // sidecar either way, and this is where "can't tell" already means null.
    await sidecarChain
    const path = await storage.dataPath(EXPORT_RUN_FILE)
    if (!(await exists(path))) return null
    return exportRunSidecarSchema.parse(JSON.parse(await readTextFile(path)))
  } catch {
    return null
  }
}

export type ExportRunProgress =
  /** Daz hasn't picked the file up yet (it can still be aborted) — or a
   *  closing Daz claimed it and died before running a row: the batch is then
   *  UNTOUCHED and parked for {@link launchDazForPendingJobs}' reclaim, which
   *  is still "waiting to run", not a dead run. */
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
      /** The verbose per-scene view from the progress log (Runner v1.2.0):
       *  the newest line's percent/message/scene + the message tail for the
       *  live log window. Null on an old Runner or before the first line. */
      step?: ExportProgressState | null
      /** When the handoff was written — absent on a display-only adoption
       *  (another window's run; this one never saw the start). */
      startedAtMs?: number
      /** The job rows as the file carries them — the pipeline panel rebuilds
       *  its Daz task cards from these when its own armed selection is gone
       *  (a display-only adoption, or a sidecar-restored watch after a
       *  reload). */
      rows?: Array<{ scenePath: string; status: 'pending' | 'running' | 'done' | 'failed' }>
      /** The run's "Export too" plan (armed or sidecar-restored watches
       *  only) — what the reloaded editor's Houdini task cards come from. */
      houdiniProjects?: Array<string>
      /** The batch's scenes (same watches) — the Houdini cards' network
       *  tooltip. */
      scenes?: Array<string>
      /** What the batch does to each scene (same watches) — the Daz task
       *  cards' subtitle. Absent on a display-only adoption: that window is
       *  reading a job file, which never carried the dialog's choice. */
      mode?: ExportMode
      /** The user asked this run to stop and it hasn't reached a stop point
       *  yet — the button says "Stopping…" instead of offering the interrupt
       *  a second time. */
      interrupted?: boolean
    }
  /** progress hit 100 — the studio has DELETED the file; final snapshot. */
  | {
      state: 'finished'
      characterId: string
      total: number
      failed: number
      errors: Array<string>
      /** The run's after-export Houdini projects ([] = none picked). */
      houdiniProjects: Array<string>
      /** What those projects do — open, or run their exports (and for which
       *  scene scope). See {@link HoudiniRunMode}. */
      houdiniMode: HoudiniRunMode
      /** The scenes the batch ran — the Houdini job's scope. */
      scenes: Array<string>
      /** Linked Unreal projects to send to once the Houdini queue drains. */
      unrealProjects: Array<string>
      /** The export sets to hand them. */
      unrealSets: Array<string>
      /** The batch ended because the user interrupted it. The counts above
       *  describe ROWS, not work: a row the generated script skipped comes
       *  back `done`, so an interrupted batch must never be reported as
       *  "n scenes exported" — and must not continue into `houdiniProjects`. */
      interrupted: boolean
      /** Handoff → finish, for the toast's "in 12m 34s". */
      elapsedMs?: number
    }
  /** The run died (Daz gone mid-run / file vanished) — watch ended. */
  | { state: 'dead'; characterId: string; total: number }

/**
 * The active run's live state (null when none), straight from the job-file
 * pair: pending file still there → 'pending'; `running_` file there → parse
 * its Runner-owned progress — at 100 the studio deletes the file and returns
 * the one 'finished' snapshot (the caller toasts the outcome). A running file
 * whose Daz has EXITED below 100 is a dead run: deleted + reported 'dead'
 * once — UNLESS the batch is still untouched ({@link isReclaimableBatch}: a
 * closing Daz claimed it and died before running a row). That one is reported
 * 'pending' and the file left in place: `launchDazForPendingJobs` (the
 * wait-for-close modal's finish) owns the rename back to pending, and this
 * watch must neither delete the file out from under it nor disarm the run —
 * the armed run still carries the finish toast and the "Export too"
 * continuation. A torn read (the Runner rewrites the file between rows) just
 * reports the last state again — the next poll gets a clean parse.
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
/**
 * Truncate the verbose progress log and return its path.
 *
 * EVERY job-file handoff calls this, not only the export one. The log is a
 * single app-data file and {@link readExportProgressState} serves it to
 * whichever batch is live — so a scan or a scene ROM build that left the
 * PREVIOUS export's lines standing would render them as its own progress: the
 * finished export's percent, its scene and its whole log tail, under the new
 * batch's task cards. Measured by reading the code paths: three of the four
 * handoffs (this file's scene ROM build, the project product scan and the
 * morph scan) write a `bulk-export` job file, and every character editor
 * adopts one for display.
 *
 * Truncating is all they do — only {@link executeCharacterJobs} also ARMS the
 * log (`progressLogPath` in the job file). An empty file is exactly what "this
 * batch has nothing to say" has to look like: the reader returns null and the
 * display falls back to row counts.
 */
async function resetExportProgressLog(): Promise<string> {
  const path = await storage.dataPath(EXPORT_PROGRESS_FILE)
  await storage.writeTextFileAtomic(path, '')
  return path
}

/** The verbose progress log's current view (Runner v1.2.0), read fresh per
 *  poll. Best-effort by construction: an unreadable/absent/empty file is null
 *  — an old Runner simply never writes one. */
async function readExportProgressState(
  /** The batch's job rows — their scene paths resolve the scene-open lines'
   *  real file names (the log carries only the stem). */
  scenePaths: ReadonlyArray<string> = [],
): Promise<ExportProgressState | null> {
  try {
    const path = await storage.dataPath(EXPORT_PROGRESS_FILE)
    if (!(await exists(path))) return null
    return exportProgressStateFrom(
      parseExportProgressLog(await readTextFile(path)),
      undefined,
      scenePaths,
    )
  } catch {
    return null
  }
}

export async function fetchExportRunProgress(watcher?: string): Promise<ExportRunProgress | null> {
  let run = activeRun
  const paths = await exporterJobFilePaths()
  if (!paths) return null
  // Sentinel runs belong to their own panel — see the doc comment above. Every
  // no-character run carries a '#'-prefixed sentinel id ({@link GENESIS_INDEX_RUN},
  // {@link PROJECT_SCAN_RUN}), so the rule is stated once for all of them rather
  // than re-cased per feature: a sentinel run is consumed ONLY by the watcher
  // passing that same sentinel, and a sentinel watcher never consumes a
  // character's run. Everything else is served the display-only adoption below.
  const isSentinel = (id: string | undefined): boolean => id !== undefined && id.startsWith('#')
  // A reloaded window: no in-memory watch, but the handoff's sidecar names
  // THIS caller's character as the run's owner and a job file is still live —
  // restore the full watch (start time, Houdini continuation, ownership).
  // Only the character's own editor restores; everything else keeps the
  // display-only adoption.
  if (!run && watcher && !isSentinel(watcher)) {
    const sidecar = await readExportRunSidecar()
    if (
      sidecar &&
      sidecar.characterId === watcher &&
      ((await exists(paths.pending)) || (await exists(paths.running)))
    ) {
      activeRun = sidecar
      run = sidecar
    }
  }
  const foreignToWatcher =
    run !== null &&
    (isSentinel(run.characterId) ? watcher !== run.characterId : isSentinel(watcher))
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
        // The armed selection is gone (a reloaded window) — but the batch's
        // identity survives in the file's own rows, and the progress log is
        // the same global singleton the Runner appends to either way: the
        // pipeline panel rebuilds its Daz cards and its log window from
        // these, instead of showing an empty shell.
        step: await readExportProgressState(parsed.jobs.map((j) => j.scenePath)),
        rows: parsed.jobs.map((j) => ({ scenePath: j.scenePath, status: j.status })),
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
          startedAtMs: run.startedAtMs,
          // Carried through the torn read too, or the button would flicker back
          // from "Stopping…" to "Interrupt" on every mid-rewrite poll.
          interrupted: run.interrupted === true,
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
        await clearExportRunSidecar()
        // The run is over however it got here — the flag has no business
        // outliving it (a leftover would skip the NEXT run silently).
        await clearCancelFlag(run.cancelPath)
        return {
          state: 'finished',
          characterId: run.characterId,
          total: parsed.jobs.length || run.total,
          interrupted: run.interrupted === true,
          elapsedMs: Date.now() - run.startedAtMs,
          failed,
          errors: parsed.jobs
            .filter((j) => j.error)
            // An empty scenePath (the contract's "new empty scene" row, e.g.
            // the genesis-index build) would prefix the line with a bare ": ".
            .map((j) => (j.scenePath ? `${j.scenePath}: ${j.error ?? ''}` : (j.error ?? ''))),
          houdiniProjects: run.houdiniProjects,
          houdiniMode: run.houdiniMode,
          scenes: run.scenes,
          unrealProjects: run.unrealProjects,
          unrealSets: run.unrealSets,
        }
      }
      // Below 100 with Daz gone = the run died (crash / user quit) — it will
      // never finish; clean up and report once. EXCEPT when the batch is still
      // untouched: a closing Daz claimed it on a final poll tick and exited
      // before running a row. That batch isn't dead, it's waiting to be handed
      // back — and exactly ONE code path does the handing back
      // (launchDazForPendingJobs' reclaim, driven by the wait-for-close
      // modal). Deleting here would race that modal's tick and strand the very
      // batch this rescue exists for; reporting 'dead' would disarm the run
      // and silently drop its finish toast + "Export too" continuation. So
      // this watch only DETECTS and defers: report 'pending', touch nothing.
      // (Without a modal — Daz died claimed-but-idle on its own — the parked
      // file waits for the next handoff's stale cleanup instead.)
      //
      // ANY Daz, deliberately: what follows DELETES the file. A probe scoped to
      // the export install would call a batch dead whenever the configured
      // folder and the running executable's path disagree — see DazRunningScope.
      const dazRunning = await dazStudioRunningNative(true, 'any')
      if (!dazRunning) {
        if (isReclaimableBatch(parsed)) {
          return { state: 'pending', characterId: run.characterId, total: run.total }
        }
        try {
          await remove(paths.running)
        } catch {
          // best effort
        }
        if (activeRun === run) activeRun = null
        await clearExportRunSidecar()
        await clearCancelFlag(run.cancelPath)
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
        startedAtMs: run.startedAtMs,
        // The verbose per-scene view (Runner v1.2.0 + the generated script's
        // own lines) — null on an old Runner / an empty log; the UI then
        // shows the row counts alone, exactly as before.
        step: await readExportProgressState(parsed.jobs.map((j) => j.scenePath)),
        // The rows + the run's Houdini plan, so an editor whose component
        // state was reloaded away (sidecar-restored watch) can re-arm its
        // task cards without having seen the Start.
        rows: parsed.jobs.map((j) => ({ scenePath: j.scenePath, status: j.status })),
        houdiniProjects: run.houdiniProjects,
        scenes: run.scenes,
        mode: run.mode,
        interrupted: run.interrupted === true,
      }
    }
  } catch {
    // transient fs error — keep the watch alive, retry next poll
    return { state: 'pending', characterId: run.characterId, total: run.total }
  }
  // Neither file exists — but only a watch that is STILL ARMED was aborted
  // externally / cleaned behind our back. A poll straddling the moment someone
  // here resolved the run (clearExporterJobFiles on a Ctrl/Settings abort,
  // dismissExportRun, a new handoff replacing `activeRun`) captured `run`
  // before the files went away — reporting 'dead' would toast a sticky
  // "run died" over a deliberate abort. That poll lost the race: say nothing.
  if (activeRun !== run) return null
  activeRun = null
  await clearExportRunSidecar()
  await clearCancelFlag(run.cancelPath)
  return { state: 'dead', characterId: run.characterId, total: run.total }
}

/**
 * Stop watching the active run (the run in Daz is unaffected — the watch is
 * an observer only). The escape hatch for a batch that errored in Daz and
 * will never deliver its remaining scenes.
 *
 * The in-memory half is synchronous — every UI caller may ignore the return
 * and does. The returned promise is the SIDECAR delete, for a caller that
 * needs it to have landed before it looks at app-data again (tests do);
 * ordering against a handoff that follows immediately is the chain's job
 * either way — see {@link queueSidecar}.
 */
export function dismissExportRun(): Promise<void> {
  activeRun = null
  // Without the clear, the next poll would restore the very watch that was
  // just dismissed.
  return clearExportRunSidecar()
}

/**
 * The interrupt flag for one character — the file whose EXISTENCE means "stop
 * this character's export run" (see {@link EXPORT_CANCEL_FILE}). Resolving it
 * needs the project, so it is done once per call rather than stored anywhere:
 * the studio writes it, the generated Daz scripts and 456.py read it, and
 * nothing else ever needs to know where it is.
 */
async function cancelFlagFor(projectId: string, id: string): Promise<string> {
  const { project, location } = await loadCharacter(projectId, id)
  return cancelFlagPath(storage.characterMetaDir(project.path, location.relFolder, id))
}

/**
 * Ask a running DTH Export to STOP — at the next point where stopping leaves
 * nothing half-written, not this instant.
 *
 * The studio cannot reach into either half of a run: Daz Studio is driven by a
 * plugin that only watches the filesystem, and the Houdini leg is a headless
 * hython the studio spawned but cannot talk to. Both of them execute code the
 * studio DID write, though — the generated `.dsa` carriers with the DTH runtime
 * behind them, and `456.py` — and those poll one flag file. So the interrupt is
 * that file, and what it actually buys is:
 *
 *  - the ROM build stops at its next block boundary (or between two custom
 *    frames — the runtime probes ~every 750 ms there);
 *  - the export that would have followed it is skipped;
 *  - every scene still queued behind it is skipped as the Runner reaches it
 *    (the Runner owns the batch and cannot be told to stop, so those rows still
 *    open their scene — they just don't do any work);
 *  - the Houdini leg stops between export nodes and closes its own hython;
 *  - the run reports as INTERRUPTED and never continues into Houdini.
 *
 * What it cannot do, and what the UI must not promise: interrupt the DTH
 * Exporter's own `doExport`, the HDA's `do_export`, or a Daz content load
 * already under way. Those are synchronous calls inside someone else's plugin;
 * the wait for the current one is the honest cost of stopping cleanly rather
 * than killing a process mid-write.
 *
 * Marking the in-memory run is deliberately best-effort-independent of the
 * FILE write: the file is what the two runtimes obey, so it is written first
 * and its failure is the only one that can fail the call.
 */
export async function interruptExportRun({ data }: { data: unknown }): Promise<void> {
  const { projectId, id } = charScopeInput.parse(data)
  const path = await cancelFlagFor(projectId, id)
  if (!path) throw new Error('This character has no meta folder yet — nothing to interrupt.')
  await mkdir(dirname(path), { recursive: true })
  // The CONTENT is documentation for whoever finds the file, never a protocol:
  // both runtimes test existence only, so a torn or empty write still stops the
  // run. (A flag that had to parse could fail to stop one.)
  await storage.writeTextFileAtomic(
    path,
    `${new Date().toISOString()} — DTH Character Studio asked this character's export run to stop. Safe to delete.\n`,
  )
  if (activeRun && activeRun.characterId === id) {
    activeRun = { ...activeRun, interrupted: true }
    await writeExportRunSidecar(activeRun)
  }
}

/**
 * Drop a character's interrupt flag. Called wherever a run BEGINS (a leftover
 * flag would silently skip the run that is starting) and wherever one ENDS.
 *
 * Best-effort everywhere: the flag is only ever read by scripts that are about
 * to run, and every one of those paths clears it first, so a delete that loses
 * to a locked file costs nothing that the next handoff doesn't fix.
 */
async function clearCancelFlag(path: string): Promise<void> {
  if (!path) return
  try {
    if (await exists(path)) await remove(path)
  } catch {
    // best effort — the next handoff clears it again
  }
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
  // The aborted handoff will never run — stop the export watch with it. Any
  // interrupt flag goes too: it exists to stop a run, and there is none left.
  // Both spellings, because the pending file may belong to ANOTHER character's
  // handoff (Abort deletes whatever is waiting) while the flag is per
  // character — clearing only one of the two would strand the other.
  await clearCancelFlag(activeRun?.cancelPath ?? '')
  activeRun = null
  await clearExportRunSidecar()
  await clearCancelFlag(await cancelFlagFor(projectId, id).catch(() => ''))
  if (rows.length === 0) return
  try {
    const { project, location } = await loadCharacter(projectId, id)
    const path = stampsPath(project, location, id)
    const stored = await readStamps(path)
    const aborted = new Set(rows.map((row) => normalizeSceneKey(row.scenePath)))
    const scenes = Object.fromEntries(
      Object.entries(stored.scenes).filter(([key]) => !aborted.has(key)),
    )
    await writeStamps(path, { version: 1, scenes })
  } catch {
    // stamp rollback is best-effort — the abort itself (the delete) succeeded
  }
}

/**
 * One job file sitting in the Daz library's studio scripts root, as Settings →
 * App Data reads it. Unscoped on purpose: {@link abortExporterJobs} needs a
 * character (it rolls that character's handoff stamps back), and the file this
 * is about is precisely one nobody can name an owner for anymore.
 */
export interface ExporterJobFileState {
  kind: JobFileKind
  /** The file's name on disk — the thing to look for in the Daz library. */
  fileName: string
  path: string
  /** How old the file is, in ms (0 when no mtime could be read). */
  ageMs: number
  /** Rows in the batch (0 when the file can't be parsed). */
  jobs: number
  /** Runner-owned progress 0–100 — always 0 on a file that was never claimed. */
  progress: number
  /** What the batch does; null when the file can't be parsed at all. */
  type: ExporterJobType | null
  /** Deleting it could strand a run in progress ({@link jobFileMayBeLive}). */
  mayBeLive: boolean
}

/** Read one of the two job-file names, tolerantly: an existing file is always
 *  reported, even torn or unreadable — that is exactly the state someone opens
 *  this readout to get rid of. */
async function readJobFileState(
  path: string,
  kind: JobFileKind,
): Promise<ExporterJobFileState | null> {
  if (!(await exists(path).catch(() => false))) return null
  const parsed = parseJobFileJson(await readTextFile(path).catch(() => ''))
  const mtime = await mtimeOf(path)
  return {
    kind,
    fileName: kind === 'pending' ? EXPORTER_JOB_FILE : RUNNING_JOB_FILE,
    path,
    ageMs: mtime > 0 ? Math.max(0, Date.now() - mtime) : 0,
    jobs: parsed?.jobs.length ?? 0,
    progress: parsed?.progress ?? 0,
    type: parsed?.type ?? null,
    mayBeLive: jobFileMayBeLive(kind, parsed),
  }
}

/**
 * Every exporter job file currently on disk (usually none, occasionally one) —
 * the Settings readout behind "clear a stranded job file".
 *
 * Both names are reported rather than the first one found: they mean different
 * things (waiting for Daz vs claimed by a Runner), and a readout that hid one
 * would be describing the wrong file at the worst possible moment. Empty in a
 * browser or without a Daz library configured — there is no job file then.
 */
export async function fetchExporterJobFiles(): Promise<Array<ExporterJobFileState>> {
  const paths = await exporterJobFilePaths()
  if (!paths) return []
  const found = await Promise.all([
    readJobFileState(paths.pending, 'pending'),
    readJobFileState(paths.running, 'running'),
  ])
  return found.filter((state) => state !== null)
}

/**
 * A compact identity of what a readout SHOWED — everything the decision to
 * delete rests on. Age is left out on purpose: it changes every second and
 * changes nothing about the judgement.
 */
export function exporterJobFilesSignature(files: Array<ExporterJobFileState>): string {
  return files.map((f) => `${f.kind}:${f.jobs}:${f.progress}:${f.mayBeLive}`).join('|')
}

/** What is on disk is no longer what the user was shown and agreed to delete. */
export class ExporterJobFilesChangedError extends Error {
  constructor() {
    super('The job file changed since you looked at it.')
    this.name = 'ExporterJobFilesChangedError'
  }
}

/**
 * Delete every exporter job file on disk — the manual way out of a batch that
 * can never start or finish, which otherwise blocks every later export AND scan
 * with "a batch is waiting for Daz Studio".
 *
 * Blunt by design: the caller (Settings) has shown the user what is there and
 * whether it might still be live ({@link fetchExporterJobFiles}), and this is
 * the action they confirmed. A delete that fails (a locked file) throws, so the
 * UI can say so instead of reporting a cleanup that didn't happen. Returns the
 * file names removed.
 *
 * **Both files are settled before anything is thrown.** One locked and one
 * removed is a real outcome (they are separate files), and letting the first
 * rejection escape would skip dropping the watch below — leaving this window
 * watching a batch whose file it had just deleted, i.e. producing the exact
 * "run died" toast this function exists to avoid.
 *
 * `expect` is the {@link exporterJobFilesSignature} of the state the user was
 * SHOWN, and passing it is what keeps the confirmation honest. The readout is
 * a snapshot — it refreshes on focus, and nothing else — while the transition
 * that matters (the Runner renaming the pending file to `running_` and starting
 * to work it) happens inside Daz, at any moment, with this window focused. So
 * the user can be looking at "written, never claimed", no warning shown, and
 * agree to delete a batch that is by then LIVE. Re-reading here and refusing on
 * a mismatch ({@link ExporterJobFilesChangedError}) means the amber warning is
 * never bypassed by the file changing under it. Omit `expect` for an unchecked
 * delete (the tests' blunt path).
 */
export async function clearExporterJobFiles(expect?: string): Promise<Array<string>> {
  if (!isTauri()) return []
  const paths = await exporterJobFilePaths()
  if (!paths) return []
  if (expect !== undefined && exporterJobFilesSignature(await fetchExporterJobFiles()) !== expect) {
    throw new ExporterJobFilesChangedError()
  }
  const results = await Promise.all(
    [
      { name: EXPORTER_JOB_FILE, path: paths.pending },
      { name: RUNNING_JOB_FILE, path: paths.running },
    ].map(async ({ name, path }) => {
      if (!(await exists(path).catch(() => false))) return { name, error: '' }
      try {
        await remove(path)
        return { name, removed: true, error: '' }
      } catch (error) {
        return { name, error: error instanceof Error ? error.message : String(error) }
      }
    }),
  )
  const removed = results.filter((r) => r.removed).map((r) => r.name)
  // Whatever this window was watching is gone with the file — leaving the watch
  // armed would only produce a "run died" toast for a batch the user just
  // cleared on purpose (same reason abortExporterJobs drops it).
  if (removed.length > 0) {
    // The interrupt flag belonged to the run these files carried — it must not
    // outlive them (unscoped call: the armed run is the only character this
    // layer can name here).
    await clearCancelFlag(activeRun?.cancelPath ?? '')
    activeRun = null
    await clearExportRunSidecar()
  }
  const failed = results.filter((r) => r.error)
  if (failed.length > 0) {
    throw new Error(failed.map((r) => `${r.name}: ${r.error}`).join('\n'))
  }
  return removed
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
  /** The scene's last Daz export is on disk (the `.dth` at {@link sceneDthPath}
   *  — the file a Houdini network imports). What "Houdini only" runs on; rows
   *  without one are disabled in that mode (nothing to rely on). */
  exportExists: boolean
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

const executeInput = charScopeInput.extend({
  /** The scenes to enqueue, chosen in the DTH Export dialog — each must be one
   *  of the character's linked scenes. */
  scenes: z.array(z.string().min(1)).min(1),
  /** What the run does — the dialog's first step. Defaults to the full
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
  /** The export sets to send ([] = nothing, which is a real choice). */
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
  activeRun = {
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
  await writeExportRunSidecar(activeRun)

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
async function reclaimOrphanedBatch(paths: { pending: string; running: string }): Promise<boolean> {
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
export const PROJECT_SCAN_RUN = '#project-scan'

/** One character's scannable scenes, as the Tools panel lists them. */
export interface ProjectScanCharacter {
  id: string
  name: string
  /** Linked scenes whose `.duf` is readable — the ones that can get a row. */
  scenes: Array<string>
  /** Linked scenes whose `.duf` is missing — named in the panel, never enqueued. */
  missing: Array<string>
}

export interface ProjectScanPlan {
  characters: Array<ProjectScanCharacter>
  /** Total scannable scenes across the project (the row count for a scene pass). */
  totalScenes: number
  /** The product pass can run: a DIM `ManifestFiles` folder is configured. That
   *  folder IS the product database — without one a scan could only report every
   *  asset as unmatched, so it is the one thing the pass needs. (The per-project
   *  "Daz Products" toggle is NOT part of this: it only decides whether the
   *  character page shows the tab.) */
  productsEnabled: boolean
  /** Same condition, kept as its own field because the panel words the two
   *  differently — "unavailable" vs "set the folder in Settings". */
  dimConfigured: boolean
}

/**
 * What a bulk scan of this project WOULD cover: every character, its readable
 * linked scenes, and whether the product pass is available at all. Read-only
 * and tolerant — a character whose `.duf` files are missing still appears (with
 * them listed as missing) rather than failing the whole plan, so the panel can
 * show the user exactly what is about to run before they start it.
 */
export async function fetchProjectScanPlan({ data }: { data: unknown }): Promise<ProjectScanPlan> {
  const { projectId } = projectIdInput.parse(data)
  if (!isTauri()) {
    return { characters: [], totalScenes: 0, productsEnabled: false, dimConfigured: false }
  }
  const project = await resolveProject(projectId)
  const settings = await storage.getSettings()
  const characters = await storage.listCharacters(charsRoot(project))
  const out: Array<ProjectScanCharacter> = []
  let totalScenes = 0
  for (const character of characters) {
    const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
    const scenes: Array<string> = []
    const missing: Array<string> = []
    for (const scene of linked) {
      if (await exists(scene).catch(() => false)) scenes.push(scene)
      else missing.push(scene)
    }
    if (scenes.length === 0 && missing.length === 0) continue
    totalScenes += scenes.length
    out.push({ id: character.id, name: character.name, scenes, missing })
  }
  return {
    characters: out,
    totalScenes,
    productsEnabled: settings.dimManifestsFolder.trim() !== '',
    dimConfigured: settings.dimManifestsFolder.trim() !== '',
  }
}

const projectScanInput = z.object({
  /** The project folder to scan. Empty is legal for a BASE-ONLY run: the stock
   *  figures belong to no project, so the Tools panel offers that pass from the
   *  Home window too (where no project is open). */
  projectId: z.string().default(''),
  /** Rebuild the BASE morph + bone index from the stock figures first — row one
   *  of the batch, and the only row a project-less run can produce. */
  base: z.boolean().default(false),
  /** Scan every linked scene for the morphs the base index doesn't carry. */
  morphs: z.boolean().default(false),
  /** Run the Daz Products scan for every linked scene. */
  products: z.boolean().default(false),
  /**
   * Restrict the scene passes to these scenes (absolute paths, matched by
   * {@link normalizeSceneKey}). Omitted = every linked scene of every
   * character — a project can hold dozens, and re-scanning all of them to
   * refresh one outfit is minutes of Daz time per scene.
   *
   * Only ever NARROWS: a path that isn't a linked scene of this project can't
   * add a row, so a stale selection (a scene unlinked between the panel's plan
   * probe and the click) silently drops out instead of enqueueing a row that
   * could only fail. All of them dropping out is caught below as "nothing to
   * run" rather than handed to Daz as an empty batch.
   */
  scenes: z.array(z.string()).optional(),
})

export interface ProjectScanSummary {
  /** Rows enqueued (the base row, if any, plus one per scene). */
  rows: number
  /** Scenes that got a row. */
  scenes: number
  /** Characters contributing at least one row. */
  characters: number
  /** Linked scenes skipped because their `.duf` is missing. */
  skipped: Array<string>
  dazWasRunning: boolean
}

/**
 * Hand a WHOLE-PROJECT scan to the Runner — Tools → **Scan project**, the
 * one-click "start it and wait" pass over everything a project can be scanned
 * for. One `bulk-export` batch:
 *
 *   row 0 (optional)  `.Build_Genesis_Index_Bulk.dsa` on an EMPTY scene — the
 *                     base morph + bone index. It runs FIRST on purpose: the
 *                     scene scans filter themselves against that index, so a
 *                     rebuild has to land before they read it, or the first
 *                     scan of a fresh install files the whole stock figure as
 *                     "what this scene adds".
 *   rows 1..n         `.Scan_Scene_Bulk.dsa`, one per linked scene, with the
 *                     sidecar ({@link SCAN_CONFIG_FILE}) saying whether that
 *                     scene is due for morphs, products, or both. One row per
 *                     SCENE rather than per scene-and-kind: opening a scene is
 *                     the slow part, so both scans share the one open.
 *
 * Same handoff mechanics as every other batch — one global job file, refuse
 * while another is live, clear a finished-but-unswept `running_`, self-heal the
 * runtime install, start Daz when it's closed, and the same ~10s claim-wait so
 * a batch is never handed to a shutting-down Daz.
 *
 * Throws with a user-facing message when the selection can produce no rows at
 * all — a batch of nothing would otherwise "succeed" without scanning anything.
 */
export async function startProjectScan({ data }: { data: unknown }): Promise<ProjectScanSummary> {
  const { projectId, base, morphs, products, scenes: chosenScenes } = projectScanInput.parse(data)
  if (!isTauri()) throw new Error('Scanning a project needs the desktop app (Daz Studio is launched natively).')
  if (!base && !morphs && !products) throw new Error('Pick at least one thing to scan.')
  // The scene passes are per project; the base pass is not. With no project
  // open (the Home window) only the base pass can run.
  if ((morphs || products) && !projectId) {
    throw new Error('Open a project to scan its characters — only the base index can be rebuilt from here.')
  }

  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) {
    throw new Error('Set “My DAZ 3D Library” in Settings first — the job file and the scripts live there.')
  }
  const project = projectId ? await resolveProject(projectId) : null
  if (products && project?.dazProductsEnabled !== true) {
    throw new Error('Daz Products is switched off for this project — enable it in Settings → Project first.')
  }

  const scriptsRoot = storage.studioScriptsDir(settings.dazLibraryFolder)
  // Self-heal before checking: an app updated since the last save has the new
  // runtime bundled but not yet installed (the marker makes this a no-op when
  // the install is already current) — the same guard the index build uses, and
  // this batch needs a script that only exists from runtime v53 on.
  await storage.copyRuntimeFiles(scriptsRoot).catch(() => {})

  const jobs: Array<ExporterJob> = []
  if (base) {
    const indexScript = joinPath(scriptsRoot, storage.GENESIS_INDEX_BULK_SCRIPT)
    if (!(await exists(indexScript))) {
      throw new Error(
        `The index script is not installed:\n${indexScript}\nRun Tools → Refresh assets to install it, then try again.`,
      )
    }
    jobs.push({ scenePath: '', scriptPath: indexScript })
  }

  const sceneWork: Array<{ scenePath: string; work: ScanSceneWork }> = []
  const skipped: Array<string> = []
  let charactersWithRows = 0
  // The user's scene pick, as match keys (undefined = every linked scene).
  const chosen = chosenScenes ? new Set(chosenScenes.map(normalizeSceneKey)) : undefined
  // `project` is non-null here: the guard above refuses a scene pass without one.
  if ((morphs || products) && project) {
    const sceneScript = joinPath(scriptsRoot, storage.SCAN_SCENE_BULK_SCRIPT)
    if (!(await exists(sceneScript))) {
      throw new Error(
        `The scene-scan script is not installed:\n${sceneScript}\nRun Tools → Refresh assets to install it, then try again.`,
      )
    }
    const characters = await storage.listCharacters(charsRoot(project))
    for (const character of characters) {
      // Per character, because the product scan's config is per character (its
      // identity and its own output folder) — the morph scan is global.
      const productsConfig: ScanProductsConfig | undefined = products
        ? {
            characterId: character.id,
            characterName: character.name,
            genesis: character.genesis,
            dimManifestPath: settings.dimManifestsFolder.replace(/\\/g, '/'),
            outputDir: (await storage.productScanDir(project.id, character.id)).replace(/\\/g, '/'),
            dazLibraryFolder: settings.dazLibraryFolder.replace(/\\/g, '/'),
          }
        : undefined
      let any = false
      for (const scene of [character.scenePath, ...character.extraScenes].filter(Boolean)) {
        // Outside the user's pick — not skipped work, just not asked for, so it
        // stays out of the summary's `skipped` list too.
        if (chosen && !chosen.has(normalizeSceneKey(scene))) continue
        // A missing `.duf` can only produce a failed row — name it in the
        // summary instead of enqueueing work that cannot run.
        if (!(await exists(scene).catch(() => false))) {
          skipped.push(scene)
          continue
        }
        sceneWork.push({
          scenePath: scene,
          work: {
            morphs,
            // The owning character's generation — the morph scan's fallback
            // when the scene's figures carry no readable asset identity.
            genesis: character.genesis,
            ...(productsConfig ? { products: productsConfig } : {}),
          },
        })
        jobs.push({ scenePath: scene, scriptPath: sceneScript })
        any = true
      }
      if (any) charactersWithRows++
    }
  }

  if (jobs.length === 0) {
    throw new Error(
      skipped.length > 0
        ? 'Every selected Daz scene is missing on disk — nothing could be scanned.'
        : chosen
          ? 'None of the selected scenes are linked to this project anymore — reopen Tools and pick again.'
          : 'This project has no linked Daz scenes to scan yet.',
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

  // The sidecar goes down BEFORE the job file: the Runner can claim the batch
  // the moment the job file appears, and a row that beat its own config would
  // fail with "not in the scan config" for no reason.
  await storage.writeTextFileAtomic(joinPath(scriptsRoot, SCAN_CONFIG_FILE), scanConfigJson(sceneWork))
  // No progress log for a scan — but the last export's must not stand in for
  // one (see resetExportProgressLog). Best effort, as above.
  await resetExportProgressLog().catch(() => {})
  const jobJson = jobFileJson(jobs)
  await storage.writeTextFileAtomic(paths.pending, jobJson)
  // Both windows can pass the exists-checks above — the read-back decides who
  // actually holds the handoff, BEFORE this window arms its watch on it.
  await assertHandoffOwned(paths.pending, jobJson)
  activeRun = {
    characterId: PROJECT_SCAN_RUN,
    total: jobs.length,
    startedAtMs: Date.now(),
    houdiniProjects: [],
    houdiniMode: 'export-selected',
    scenes: sceneWork.map((s) => s.scenePath),
    unrealProjects: [],
    unrealSets: [],
    // A scan is not an export mode at all; the sentinel run has no character
    // editor to draw task cards for, so the field's value never reaches a UI.
    mode: 'rom-export',
    // Not interruptible by the export flag: a scan spans MANY characters (so
    // there is no one flag to write) and it has its own way out —
    // {@link abortProjectScanRun}. The scan scripts probe nothing.
    cancelPath: '',
  }

  const dazWasRunning = await dazStudioRunningNative(false, 'export')
  const summary: ProjectScanSummary = {
    rows: jobs.length,
    scenes: sceneWork.length,
    characters: charactersWithRows,
    skipped,
    dazWasRunning,
  }
  if (!dazWasRunning) {
    // A fresh launch claims the file on startup — no wait (Daz can take long to
    // come up; the panel's pending state covers it, with Abort as the out).
    await launchDazSceneless('minimized')
    return summary
  }
  // A "running" Daz may be SHUTTING DOWN (the process lingers, its Runner poller
  // is already gone) — or running without the Runner. Same claim-wait as every
  // other handoff: take the batch back rather than leave it pending forever.
  const deadline = Date.now() + OPEN_SCENE_PICKUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, OPEN_SCENE_POLL_MS))
    if (!(await exists(paths.pending).catch(() => true))) return summary
  }
  if (activeRun?.characterId === PROJECT_SCAN_RUN) {
    activeRun = null
    await remove(paths.pending).catch(() => {})
  }
  throw new Error(
    'Daz Studio never picked the job up — it is most likely still shutting down (or the Runner plugin is not running). The handoff was taken back; wait for Daz Studio to close fully, then try again.',
  )
}

/**
 * Abort a project-scan handoff still WAITING for Daz Studio (the un-renamed job
 * file): delete it and drop the watch — the Tools panel's way out of the pending
 * state. The sidecar is left in place: it is inert without a batch pointing at
 * it, and the next scan overwrites it. A file the Runner already claimed is left
 * alone; the watch still ends ({@link dismissExportRun}'s promise).
 */
export async function abortProjectScanRun(): Promise<void> {
  if (activeRun?.characterId !== PROJECT_SCAN_RUN) return
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
   * save, so it dates the definition the ROM would be built from now).
   *
   * That makes it a MUCH stricter test than it reads: since every character
   * save rewrites the script, one edit of anything stales every saved animation
   * of that character. So `current` gates whether a REBUILD is worth offering —
   * never whether the file may be opened. Stale ⇒ the card marks the open entry
   * and adds "Open and Generate" under it; {@link exists} alone decides that the
   * entry is there at all.
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

// --- Import from Daz scene: a headless Scan_Frames run ----------------------

/** Tolerance on "this file was written by THIS run": FAT/exFAT stamp mtimes to
 *  2-second granularity, so a file written right after the clock reading can
 *  land just before it. A scan takes many seconds, so nothing real is missed. */
const MTIME_SLACK_MS = 2000

const scanSceneInput = z.object({
  /** The `.duf` to open and scan — already validated by `sceneScanRows`. */
  scenePath: z.string().min(1),
  /** The character's generation, e.g. "G9". The silent run selects the figure
   *  by ASSET identity from it (`dthFindGenerationFigure`). */
  genesis: z.string().min(1),
})

/** Where a started scan will land, so the caller can poll for it. */
export interface SceneScanStarted {
  /** The CSV this run is predicted to write ({@link scanCsvPath}) — the studio's
   *  half of the naming contract with the `.dsa`, stated where it can be
   *  asserted. NOT the path to import: the poll reports the one the result file
   *  names, which is authoritative even if this guess were wrong. */
  csvPath: string
  resultPath: string
  /** When the handoff went down. The poll requires the CSV to be newer than
   *  this, which is what keeps a previous scan's file from being imported as
   *  this run's (see {@link fetchSceneScanProgress}). */
  startedAtMs: number
  /** False ⇒ the studio started Daz itself, and the wait covers a cold launch.
   *  True ⇒ a live Runner claimed the batch before this returned. */
  dazWasRunning: boolean
}

/**
 * Hand a headless frame scan of `scenePath` to the job runner.
 *
 * The same handoff every batch uses — one global job file, refuse while another
 * is live, read back what we wrote — because a scan is a batch like any other
 * from the Runner's point of view: it opens the scene and runs the script.
 *
 * **The stale-result delete is not tidying.** The poll's whole termination
 * condition is "the result file for this scene appeared". A previous scan of
 * the same scene left one, so without removing it first the dialog would read
 * the OLD verdict — instantly — and call the new scan finished before Daz had
 * opened anything. The previous CSV is deliberately NOT deleted: a scan that
 * then fails would have destroyed a working import for nothing, and `startedAtMs`
 * already stops the old file being read as this run's.
 *
 * Like every other handoff writer, a Daz that is ALREADY running gets the
 * claim-wait: the Runner renames the file within a poll interval, and when the
 * rename never comes the handoff is taken back rather than left pending
 * forever — a stranded job file blocks every later batch with "an export batch
 * is waiting", and this dialog would spin on a scan nobody is running.
 */
export async function startSceneScan({ data }: { data: unknown }): Promise<SceneScanStarted> {
  const { scenePath, genesis } = scanSceneInput.parse(data)
  if (!isTauri()) throw new Error('Scanning a Daz scene needs the desktop app.')
  const settings = await storage.getSettings()
  if (!settings.dazLibraryFolder) {
    throw new Error(
      'Set “My DAZ 3D Library” in Settings first — the job file and the scan script live there.',
    )
  }
  const outDir = await storage.scanFramesDir()
  const csvPath = scanCsvPath(outDir, scenePath)
  const resultPath = scanResultPath(outDir, scenePath)

  // The per-run script goes in the scripts ROOT, beside the runtime it includes
  // (it resolves `.DthUtils.dsa` / `.DthScanFrames.dsa` from its own folder).
  const scriptPath = joinPath(storage.studioScriptsDir(settings.dazLibraryFolder), SCAN_RUN_SCRIPT)
  const runtimeProbe = joinPath(storage.studioScriptsDir(settings.dazLibraryFolder), '.DthUtils.dsa')
  if (!(await exists(runtimeProbe))) {
    throw new Error(
      'The DTH runtime is not installed in your Daz library yet — save a character (or run Tools → Refresh assets) once, then try again.',
    )
  }

  const paths = await exporterJobFilePaths()
  if (!paths) throw new Error('Set “My DAZ 3D Library” in Settings first.')
  if (await exists(paths.pending)) {
    throw new Error('An export batch is waiting for Daz Studio — let it start (or abort it) first.')
  }
  if (await exists(paths.running)) {
    const finished = await readTextFile(paths.running)
      .then((text) => parseJobFileJson(text)?.progress === 100)
      .catch(() => false)
    if (!finished) {
      throw new Error('Daz Studio is working through an export batch — try again when it finishes.')
    }
    await remove(paths.running).catch(() => {})
  }

  await mkdir(outDir, { recursive: true }).catch(() => {})
  await remove(resultPath).catch(() => {})
  await storage.writeTextFileAtomic(scriptPath, scanRunScript({ outDir, resultPath, genesis }))

  // Stamped BEFORE the handoff, so every file this run writes is newer than it.
  const startedAtMs = Date.now()
  // No progress log for a morph scan either — and no inherited one (see
  // resetExportProgressLog). Best effort, as above.
  await resetExportProgressLog().catch(() => {})
  const jobJson = jobFileJson([{ scenePath, scriptPath }])
  await storage.writeTextFileAtomic(paths.pending, jobJson)
  await assertHandoffOwned(paths.pending, jobJson)
  const dazWasRunning = await dazStudioRunningNative(false, 'export')
  if (!dazWasRunning) {
    // A fresh launch claims the file on startup — no wait (Daz can take long to
    // come up; the dialog's waiting state covers it, with Cancel as the out).
    await launchDazSceneless('minimized')
    return { csvPath, resultPath, startedAtMs, dazWasRunning }
  }
  // A "running" Daz may be SHUTTING DOWN (the process lingers, its Runner poller
  // is already gone) — or running without the Runner plugin at all, which is the
  // one requirement of this feature nothing else can check. Same claim-wait as
  // every other handoff: take the batch back rather than leave it pending
  // forever, blocking every export and scan that comes after it.
  const deadline = Date.now() + OPEN_SCENE_PICKUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, OPEN_SCENE_POLL_MS))
    // The rename IS the claim (contract v2 lifecycle, shared by every type).
    if (!(await exists(paths.pending).catch(() => true))) {
      return { csvPath, resultPath, startedAtMs, dazWasRunning }
    }
  }
  await remove(paths.pending).catch(() => {})
  throw new Error(
    'Daz Studio never picked the scan up — it is most likely still shutting down, or running without the Runner plugin (the same one DTH Export needs). The handoff was taken back; check the Runner in Settings, then try again.',
  )
}

/**
 * Abort a scan handoff still WAITING for Daz Studio — the dialog's way out of
 * the spinner, and the reason closing it can't strand the global job file.
 *
 * Deletes the pending file only when it is still OUR scan (its one row points at
 * {@link SCAN_RUN_SCRIPT}): an export batch queued meanwhile belongs to someone
 * else, and taking it away would strand that run instead. A batch the Runner has
 * already CLAIMED is left alone — the rename means Daz is running it, and the
 * result file it writes is simply nobody's business by then.
 */
export async function abortSceneScan(): Promise<void> {
  if (!isTauri()) return
  try {
    const paths = await exporterJobFilePaths()
    if (!paths) return
    const parsed = parseJobFileJson(await readTextFile(paths.pending).catch(() => ''))
    const jobs = parsed?.jobs ?? []
    // `every` on an empty list is vacuously true — an unrecognisable batch is
    // somebody's, not ours.
    const ours = jobs.length > 0 && jobs.every((job) => job.scriptPath.endsWith(SCAN_RUN_SCRIPT))
    if (ours) await remove(paths.pending).catch(() => {})
  } catch {
    // Nothing to take back, or unreadable — either way there is no scan of ours
    // left pending to abort.
  }
}

/**
 * Remove the Runner's claimed job file once it reports the batch finished.
 *
 * The export flow's progress watch owns this for its own batches; a scan has no
 * watch, so this is where it happens. Only a FINISHED file (`progress: 100`) is
 * removed — a live batch's file is somebody else's, and deleting it would strand
 * the run that owns it.
 */
async function clearFinishedJobFile(): Promise<void> {
  try {
    const paths = await exporterJobFilePaths()
    if (!paths) return
    if (!(await exists(paths.running))) return
    const finished = await readTextFile(paths.running)
      .then((text) => parseJobFileJson(text)?.progress === 100)
      .catch(() => false)
    if (finished) await remove(paths.running).catch(() => {})
  } catch {
    // A leftover blocks nothing — the next start sweeps a finished one.
  }
}

/** A started scan, as the dialog polls it. */
export interface SceneScanProgress {
  state: 'running' | 'done' | 'failed'
  csvPath: string
  frames: number
  error: string
}

/**
 * Poll one started scan.
 *
 * Reads the RESULT file, never "did a CSV appear": the result is what
 * distinguishes "still running" from "ran and found nothing", and a CSV alone
 * cannot say which. A torn read is `running` — the file is written while Daz
 * has it open, and treating a half-written one as failed would abort a scan
 * about to succeed.
 *
 * `done` still insists the CSV is on disk AND newer than the run that claims it
 * ({@link SceneScanStarted.startedAtMs}). The result says the script believed it
 * wrote one — but a `printCSV` that fails silently (locked file, full disk)
 * leaves the PREVIOUS scan's CSV sitting at exactly that path, and importing
 * that would be the worst outcome available: stale frames, reported as success.
 * The mtime is the same freshness test {@link romAnimationFresh} uses for a
 * regenerated file, and it costs no user data — unlike deleting the old CSV up
 * front, which throws away a working import whenever the new scan fails.
 */
export async function fetchSceneScanProgress({
  data,
}: {
  data: unknown
}): Promise<SceneScanProgress> {
  const { resultPath, startedAtMs } = z
    .object({ resultPath: z.string().min(1), startedAtMs: z.number().default(0) })
    .parse(data)
  if (!isTauri()) return { state: 'running', csvPath: '', frames: 0, error: '' }
  const text = await readTextFile(resultPath).catch(() => '')
  if (!text) return { state: 'running', csvPath: '', frames: 0, error: '' }
  const result = parseScanResult(text)
  if (!result) return { state: 'running', csvPath: '', frames: 0, error: '' }
  // The scan is over either way — clear the claimed job file the Runner left
  // behind. The EXPORT flow's watch does this for its own batches; a scan has
  // no watch, so without it a finished `running_…json` sits in the user's
  // scripts folder until the next scan happens to sweep it (measured on the
  // first live run). Best-effort: a leftover blocks nothing (the next start
  // removes a finished one), so failing here must not fail the scan.
  await clearFinishedJobFile()
  if (!result.ok) {
    return { state: 'failed', csvPath: '', frames: 0, error: result.error || 'The scan failed.' }
  }
  if (!(await exists(result.csvPath))) {
    return {
      state: 'failed',
      csvPath: '',
      frames: 0,
      error: `The scan reported success but wrote no CSV:\n${result.csvPath}`,
    }
  }
  // A filesystem with coarse timestamps can stamp a file a beat before the
  // clock reading that started the run; the slack keeps that from reading as
  // "stale", and is far shorter than any scan takes.
  if (startedAtMs > 0 && (await mtimeOf(result.csvPath)) < startedAtMs - MTIME_SLACK_MS) {
    return {
      state: 'failed',
      csvPath: '',
      frames: 0,
      error: `The scan reported success but left the previous CSV in place — nothing was written this run:\n${result.csvPath}`,
    }
  }
  return { state: 'done', csvPath: result.csvPath, frames: result.frames, error: '' }
}
