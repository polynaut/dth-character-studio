/**
 * The state of an export RUN: the sidecar that records which window owns it,
 * the progress log the Runner writes, the interrupt/abort paths, and the
 * job-file state the UI polls.
 *
 * Layer 2 of `api/execute/` — imports `primitives.ts`, imports no sibling above.
 */
import { exists, mkdir, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../../storage'
import {
  EXPORTER_JOB_FILE,
  EXPORT_MODES,
  EXPORT_PROGRESS_FILE,
  HOUDINI_RUN_MODES,
  RUNNING_JOB_FILE,
  exportProgressStateFrom,
  isReclaimableBatch,
  jobFileMayBeLive,
  normalizeSceneKey,
  parseExportProgressLog,
  parseJobFileJson,
} from '../../execute-jobs'
import { cancelFlagPath, ROM_RUN_LOG_FILE } from '@dth/rom'
import { LAST_ROM_RUN_FILE } from '../../character-internals.ts'
import { parseRomRunLogText } from '../../run-log.ts'
import type { RomRunSceneRun } from '../../run-log.ts'
import { charScopeInput, dirname, joinPath } from '../core'
import type {
  ExporterJob,
  ExporterJobType,
  ExportMode,
  ExportProgressState,
  HoudiniRunMode,
  JobFileKind,
} from '../../execute-jobs'

import {
  dazStudioRunningNative,
  exporterJobFilePaths,
  loadCharacter,
  mtimeOf,
  readStamps,
  stampsPath,
  writeStamps,
} from './primitives.ts'

export interface ActiveExportRun {
  characterId: string
  total: number
  /** When THIS window wrote the handoff (`Date.now()`) — what the progress
   *  button's elapsed clock and the finish toast's total time count from.
   *  In-memory like the rest of the watch: a reloaded window (display-only
   *  adoption) doesn't know it, and simply shows no time. */
  startedAtMs: number
  /** The panel's SELECTED Houdini projects (`.hip`), in list order — what the
   *  finish continuation works through once the batch is done ([] = none). */
  houdiniProjects: Array<string>
  /** What those projects do when their turn comes — the Houdini list's Mode
   *  dropdown (see {@link HoudiniRunMode}; api/houdini.ts runs the exports). */
  houdiniMode: HoudiniRunMode
  /** Linked `.uproject`s to hand the finished export to, once the Houdini
   *  queue behind this batch has drained ([] = none). Rides the whole run for
   *  the same reason the Houdini plan does: the send is minutes away. */
  unrealProjects: Array<string>
  /** The export sets to hand over — the ones this run puts in play ([] = not
   *  known, so the send hands over every set in the export folder). */
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
/**
 * The export run THIS window owns — the one slot the whole feature shares.
 *
 * A holder object rather than a bare `let` because the writers live in sibling
 * modules (`jobs.ts` arms a handoff, `scans.ts` arms and clears a project
 * scan), and an imported binding is read-only across a module boundary. Same
 * single slot, same semantics as before the split — only the spelling changed.
 */
export const runOwner: { current: ActiveExportRun | null } = { current: null }

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
export const EXPORT_RUN_FILE = 'export-run.json'

export const exportRunSidecarSchema = z.object({
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
export let sidecarChain: Promise<void> = Promise.resolve()
export function queueSidecar(op: () => Promise<void>): Promise<void> {
  sidecarChain = sidecarChain.then(op, op)
  return sidecarChain
}

/** Best-effort — a failed write only degrades a later reload to the
 *  display-only adoption. */
export function writeExportRunSidecar(run: ActiveExportRun): Promise<void> {
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

export function clearExportRunSidecar(): Promise<void> {
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
export async function readExportRunSidecar(): Promise<ActiveExportRun | null> {
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
       *  reading a job file, which never carried the panel's choice. */
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
      /** WHICH scenes those failed rows were — `failed` as a list. The count
       *  alone cannot be deduped against, and every later channel that judges
       *  the same scenes (the export-landed guard) has to know which ones this
       *  run already counted, or one scene is counted twice and a healthy
       *  sibling's continuation is dropped with it. */
      failedScenes: Array<string>
      errors: Array<string>
      /** The run's after-export Houdini projects ([] = none picked). */
      houdiniProjects: Array<string>
      /** What those projects do — open, or run their exports (and for which
       *  scene scope). See {@link HoudiniRunMode}. */
      houdiniMode: HoudiniRunMode
      /** The scenes the batch ran — the Houdini job's scope. */
      scenes: Array<string>
      /** What the batch did to them — the continuation's export-landed guard
       *  keys off this (a ROM-only run wrote no export set to verify). */
      mode: ExportMode
      /** Linked Unreal projects to send to once the Houdini queue drains. */
      unrealProjects: Array<string>
      /** The export sets to hand them. */
      unrealSets: Array<string>
      /** The batch ended because the user interrupted it. The counts above
       *  describe ROWS, not work: a row the generated script skipped comes
       *  back `done`, so an interrupted batch must never be reported as
       *  "n scenes exported" — and must not continue into `houdiniProjects`. */
      interrupted: boolean
      /** Scenes whose generated script reported a FAILURE of its own during
       *  this run — the outcome `failed` above cannot see. The Runner marks a
       *  row `done` when the script it started returns, success or not: a
       *  script that refuses (wrong scene), or bails (no runtime), or fails
       *  mid-ROM comes back exactly like one that exported, so believing the
       *  rows alone reports a run that wrote nothing as "1 scene exported"
       *  (measured 2026-08-14). Read out of the character's ROM run log,
       *  restricted to entries written since the handoff, and with any scene
       *  already counted in `failed` removed — so `failed + scriptFailures
       *  .length` is the run's true failure count. A scene whose only problem
       *  was an unappliable MORPH is NOT in here ({@link producedNothing}):
       *  its ROM built and its export ran. */
      scriptFailures: Array<{ scene: string; sceneName: string; errors: Array<string> }>
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
export async function resetExportProgressLog(): Promise<string> {
  const path = await storage.dataPath(EXPORT_PROGRESS_FILE)
  await storage.writeTextFileAtomic(path, '')
  return path
}

/** The verbose progress log's current view (Runner v1.2.0), read fresh per
 *  poll. Best-effort by construction: an unreadable/absent/empty file is null
 *  — an old Runner simply never writes one. */
export async function readExportProgressState(
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

/**
 * Did this scene's script FAIL, as opposed to merely having something to report?
 *
 * Not `!ok`. The runtime writes `ok: bFinished && errors + failedMorphs === 0`
 * (`DthWorkflow.dsa`), which folds two very different outcomes into one flag:
 *
 *  - an **error** means the scene produced nothing — the ROM aborted, the
 *    runtime was missing, the scene was refused, the export never ran;
 *  - a **failed morph** is a per-dial partial the product treats as routine:
 *    the frame slot stays (empty), the rest of the ROM is unaffected, the
 *    export runs, and the character page lists the morph for repair. Its own
 *    words: "their frames stay in the ROM (empty), so the rest of the
 *    character is unaffected" (`rom-run-log-report.tsx`).
 *
 * Believing `ok` alone would report a clean one-scene export that missed a
 * single dial as "1 of 1 scene failed" AND — because both continuations gate
 * on `failed < total` — silently drop the Houdini and Unreal legs of a run that
 * exported perfectly well. That is the same class of lie as the one this whole
 * file exists to fix, only pointing the other way.
 *
 * A run that is `!ok` with NOTHING to say still counts: `ApplyDTHWorkflow` has
 * `return false` paths that log nothing, and a silent bail is a failure whose
 * message got lost, not a success.
 */
function producedNothing(run: RomRunSceneRun): boolean {
  return !run.ok && (run.errors.length > 0 || run.failedMorphs.length === 0)
}

/**
 * What the generated scripts themselves reported during this run — the half of
 * the outcome the job file cannot carry.
 *
 * The Runner's contract ends at "the script I started returned": a row whose
 * script refused the scene, bailed for want of a runtime, or failed mid-ROM
 * comes back `done`, indistinguishable from one that exported. The scripts say
 * so in their own channel, the character's ROM run log — so that is where the
 * truth for the finish report lives.
 *
 * Read-only on purpose. `fetchRomRunLog` (the character page) INGESTS: it
 * merges the Daz-written transport into the stored copy and deletes it. Which
 * of the two files holds this run's entry therefore depends on whether the
 * user happened to tab back mid-batch, so both are read and the newest write
 * per scene wins. Ingesting here as well would race that path and could delete
 * a log before the page ever showed it.
 *
 * Scoped by TIME (entries written since the handoff) so a failure the user has
 * already seen and moved on from can't resurface as this run's, and by SCENE
 * (rows the Runner itself failed are dropped) so one scene cannot be counted
 * twice.
 */
async function scriptRunFailures(
  /** The run's interrupt-flag path — its folder IS the character's meta
   *  folder, which is where both run-log files live. '' for a character
   *  without one: no meta folder, no run log, nothing to read. */
  cancelPath: string,
  startedAtMs: number,
  failedRowScenes: ReadonlyArray<string>,
): Promise<Array<{ scene: string; sceneName: string; errors: Array<string> }>> {
  if (!cancelPath) return []
  const metaDir = dirname(cancelPath)
  // Both files, in parallel: they are independent reads, and which one holds
  // this run's entry is not something to serialize on.
  const logs = await Promise.all(
    [LAST_ROM_RUN_FILE, ROM_RUN_LOG_FILE].map(async (name) => {
      try {
        const path = joinPath(metaDir, name)
        return (await exists(path)) ? parseRomRunLogText(await readTextFile(path)).runs : []
      } catch {
        // Missing, torn mid-write, or corrupt — the other file may still carry
        // this run's entry. A run log we cannot read is not evidence of
        // success, but it is not evidence of failure either: report what IS
        // readable and let the character page's own report surface the rest.
        return []
      }
    }),
  )
  const newest = new Map<string, RomRunSceneRun>()
  for (const entry of logs.flat()) {
    const key = normalizeSceneKey(entry.scene)
    const held = newest.get(key)
    if (!held || entry.finishedAtMs >= held.finishedAtMs) newest.set(key, entry)
  }
  const alreadyFailed = new Set(failedRowScenes.map(normalizeSceneKey))
  return [...newest.values()]
    .filter(
      (r) =>
        producedNothing(r) &&
        r.finishedAtMs >= startedAtMs &&
        !alreadyFailed.has(normalizeSceneKey(r.scene)),
    )
    .map((r) => ({ scene: r.scene, sceneName: r.sceneName, errors: r.errors }))
}

export async function fetchExportRunProgress(watcher?: string): Promise<ExportRunProgress | null> {
  let run = runOwner.current
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
      runOwner.current = sidecar
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
        if (runOwner.current === run) runOwner.current = null
        await clearExportRunSidecar()
        // The run is over however it got here — the flag has no business
        // outliving it (a leftover would skip the NEXT run silently).
        await clearCancelFlag(run.cancelPath)
        const failedScenes = parsed.jobs.filter((j) => j.status === 'failed').map((j) => j.scenePath)
        return {
          state: 'finished',
          characterId: run.characterId,
          total: parsed.jobs.length || run.total,
          interrupted: run.interrupted === true,
          elapsedMs: Date.now() - run.startedAtMs,
          failed,
          failedScenes,
          scriptFailures: await scriptRunFailures(run.cancelPath, run.startedAtMs, failedScenes),
          errors: parsed.jobs
            .filter((j) => j.error)
            // An empty scenePath (the contract's "new empty scene" row, e.g.
            // the genesis-index build) would prefix the line with a bare ": ".
            .map((j) => (j.scenePath ? `${j.scenePath}: ${j.error ?? ''}` : (j.error ?? ''))),
          houdiniProjects: run.houdiniProjects,
          houdiniMode: run.houdiniMode,
          scenes: run.scenes,
          mode: run.mode,
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
        if (runOwner.current === run) runOwner.current = null
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
  // dismissExportRun, a new handoff replacing `runOwner.current`) captured `run`
  // before the files went away — reporting 'dead' would toast a sticky
  // "run died" over a deliberate abort. That poll lost the race: say nothing.
  if (runOwner.current !== run) return null
  runOwner.current = null
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
  runOwner.current = null
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
export async function cancelFlagFor(projectId: string, id: string): Promise<string> {
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
  if (runOwner.current && runOwner.current.characterId === id) {
    runOwner.current = { ...runOwner.current, interrupted: true }
    await writeExportRunSidecar(runOwner.current)
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
export async function clearCancelFlag(path: string): Promise<void> {
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
  await clearCancelFlag(runOwner.current?.cancelPath ?? '')
  runOwner.current = null
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
export async function readJobFileState(
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
    await clearCancelFlag(runOwner.current?.cancelPath ?? '')
    runOwner.current = null
    await clearExportRunSidecar()
  }
  const failed = results.filter((r) => r.error)
  if (failed.length > 0) {
    throw new Error(failed.map((r) => `${r.name}: ${r.error}`).join('\n'))
  }
  return removed
}

/** One linked scene's state for the DTH Export panel. */
