/**
 * The DTH Export API's shared primitives: resolving a character and its scenes
 * root, the handoff stamps, the Daz-process probes and launch, and the job-file
 * paths every leg of the feature is written against.
 *
 * The bottom layer of `api/execute/` — it imports from no sibling, and the
 * three layers above it (run-state → jobs → scans) all bottom out here.
 */
import { exists, mkdir, readTextFile, remove, stat } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../../storage'
import {
  EXECUTE_STAMPS_FILE,
  EXPORTER_JOB_FILE,
  RUNNING_JOB_FILE,
  isReclaimableBatch,
  openSceneJobFileJson,
  parseExecuteStamps,
  parseJobFileJson,
} from '../../execute-jobs'
import { normalizePathLower } from '#/lib/path.ts'
import { deriveScenesRootRel } from '#/lib/scene-subfolder.ts'
import { relativeInside } from '../../storage/fs'
import {
  charsRoot,
  dirname,
  joinPath,
  locateCharacter,
  resolveProject,
  exportDazInstallFolder,
} from '../core'
import type { ProjectInfo } from '../core'
import type { ExecuteStamps } from '../../execute-jobs'
import type { CharacterLocation } from '../../storage'
import type { Character } from '@dth/rom'

/** Resolve the character + its on-disk location for either entry point. */
export async function loadCharacter(
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
export function stampsPath(project: ProjectInfo, location: CharacterLocation, id: string): string {
  return joinPath(
    storage.characterMetaDir(project.path, location.relFolder, id),
    EXECUTE_STAMPS_FILE,
  )
}

/** Read a character's stored handoff stamps (missing/corrupt = empty). */
export async function readStamps(path: string): Promise<ExecuteStamps> {
  try {
    if (await exists(path)) return parseExecuteStamps(await readTextFile(path))
  } catch {
    // unreadable stamps = no stamps — worst case a scene re-runs needlessly
  }
  return { version: 1, scenes: {} }
}

/** Replace a character's handoff stamps, creating the meta folder if a character
 *  reaches DTH Export before anything else has written there. */
export async function writeStamps(path: string, stamps: ExecuteStamps): Promise<void> {
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
export type DazRunningScope = 'export' | 'any'

/**
 * `daz_studio_running` through the FFI ritual (a primitive return still goes
 * through a schema — see api/native-types.ts). `fallback` keeps each call site's
 * failure bias: "assume running" where clobbering a live batch is the risk,
 * "assume closed" where a needless launch is the risk. `scope` is stated at
 * every call site on purpose — see {@link DazRunningScope}; there is no default
 * that is right for both kinds of caller.
 */
export async function dazStudioRunningNative(
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
export type DazLaunchVisibility = 'minimized' | 'visible'

/** How long the native watch waits for a launched Daz to show its main window
 *  before dropping the minimize. Generous because a cold Daz with a large
 *  content library takes tens of seconds to paint one; the launch itself has
 *  already succeeded either way. */
export const MINIMIZE_WINDOW_TIMEOUT_MS = 60_000

/** Start a scene-less Daz Studio (its Runner claims the pending job file on
 *  startup). The command returns the launched exe path — schema-parsed at the
 *  boundary like every native return, and what the minimize watch matches on.
 *
 *  The EXPORT install, not the active one: this is the launch that needs the
 *  Runner plugin, and "Export only" exists so a machine whose newest Studio has
 *  no Runner build yet can still export from the older one. With no card
 *  flagged the two resolve to the same folder. */
export async function launchDazSceneless(visibility: DazLaunchVisibility): Promise<void> {
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
export async function assertHandoffOwned(pendingPath: string, written: string): Promise<void> {
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
export async function exporterJobFilePaths(): Promise<{ pending: string; running: string } | null> {
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
export const OPEN_SCENE_PICKUP_TIMEOUT_MS = 10_000
export const OPEN_SCENE_POLL_MS = 400

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
export function sweepFinishedOpenScene(runningPath: string): void {
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
export async function mtimeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).mtime?.getTime() ?? 0
  } catch {
    return 0
  }
}

/** One scene's saved ROM animation — what the scene card's open menu offers. */
