/**
 * The export supervisor — the studio-side half of the fresh-session-per-row
 * orchestration (job-file contract v4).
 *
 * Why it exists: Daz's re-evaluation of fitted followers silently degrades
 * after a scene re-load inside one Daz session (measured 2026-08-24/25, DS4
 * 4.24 — every scripted export after a re-load froze eyes/grafts/clothing at
 * identical frame counts, 5/5 reproductions, while the figure kept moving; the
 * exporter measured every public evaluation API ineffective from inside). The
 * PREVENTION is session hygiene: one Daz process per export row. The Runner
 * (v1.4.0) runs one row per session and quits; something OUTSIDE Daz must
 * notice the exit and start the next session — the Runner dies with the
 * process it would have to restart. That something is this module.
 *
 * The rule itself is pure ({@link superviseFreshSession} in execute-jobs.ts);
 * this file is only the I/O shell: read the job-file pair, probe the process,
 * execute the one action the rule returns. Ticks are interval-driven and
 * re-entrancy-guarded; every action is paced so a wrong read costs one tick,
 * not a launch storm.
 *
 * Lives in the window that OWNS the run (armed at the handoff, re-armed by
 * the editor's poll after a reload via the run sidecar). If that window is
 * closed mid-batch the batch parks between sessions — the pending file keeps
 * the worked rows and supervision resumes when the window is back. That is
 * the honest trade: the alternative (a Runner-side loop) cannot exist, and a
 * batch that silently reused a worn session was measured to export garbage.
 */
import { exists, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../../storage'
import {
  jobFileTextOf,
  parseJobFileJson,
  requeueCrashedBatch,
  superviseFreshSession,
} from '../../execute-jobs'
import type { ExporterJobFile } from '../../execute-jobs'
import { exportDazInstallFolder } from '../core'
import {
  exportDazStudioRunning,
  exporterJobFilePaths,
  launchDazSceneless,
  mtimeOf,
} from './primitives.ts'
import { runOwner } from './run-state.ts'

/** Tick pace. Cheap per tick (two exists + an occasional small parse), and the
 *  state it watches changes on the scale of scene loads and exports. */
const SUPERVISOR_TICK_MS = 5_000

/** Minimum spacing between two Daz launches — a launch that is going to work
 *  needs tens of seconds before it can claim anything. */
const LAUNCH_PACE_MS = 30_000

/** Launches per batch before the supervisor declares the machine unable to
 *  keep a Daz alive and fails the remaining rows loudly. Generous: a healthy
 *  batch needs exactly one launch per remaining row. */
const MAX_LAUNCHES_PER_BATCH = 20

/** Minimum spacing between two kill attempts (a kill that found nothing to
 *  terminate — an elevated Daz — must not machine-gun the API). */
const KILL_PACE_MS = 60_000

let timer: ReturnType<typeof setInterval> | null = null
let ticking = false
let lastLaunchAt = 0
let lastKillAt = 0
let launches = 0

/**
 * Arm the supervisor for the run this window owns — idempotent, and a no-op
 * unless the armed run asked for fresh sessions. Called at the handoff and
 * from the editor's status poll (which is what re-arms after a reload, once
 * the sidecar restored the run).
 */
export function ensureExportSupervisor(): void {
  if (!isTauri()) return
  const run = runOwner.current
  if (!run || run.sessionPerRow !== true) return
  if (timer) return
  launches = 0
  lastLaunchAt = 0
  lastKillAt = 0
  timer = setInterval(() => {
    void supervisorTick()
  }, SUPERVISOR_TICK_MS)
}

function stopExportSupervisor(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** Exposed for tests: run one tick now (the interval calls the same thing). */
export async function supervisorTick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    await runTick()
  } catch {
    // A transient fs/process-probe error costs one tick — the next one reads
    // fresh state. The supervisor must never die on a blip mid-batch.
  } finally {
    ticking = false
  }
}

type ReadFile = ExporterJobFile | 'absent' | null

async function readJobFile(path: string): Promise<ReadFile> {
  if (!(await exists(path).catch(() => false))) return 'absent'
  const text = await readTextFile(path).catch(() => '')
  return parseJobFileJson(text)
}

/** ms since `path` changed; 0 (never "long ago") when the mtime is unreadable
 *  — an unknown age must not read as an exceeded timeout. */
async function quietMsOf(path: string, now: number): Promise<number> {
  const mtime = await mtimeOf(path)
  return mtime > 0 ? Math.max(0, now - mtime) : 0
}

async function runTick(): Promise<void> {
  const run = runOwner.current
  if (!run || run.sessionPerRow !== true) {
    // The run ended however it ended (finish sweep, abort, dismiss) — the
    // watch cleared the owner slot and this loop's job with it.
    stopExportSupervisor()
    return
  }
  const paths = await exporterJobFilePaths()
  if (!paths) {
    stopExportSupervisor()
    return
  }
  const now = Date.now()
  const pending = await readJobFile(paths.pending)
  const running = await readJobFile(paths.running)
  const action = superviseFreshSession({
    pending,
    running,
    dazRunning: await exportDazStudioRunning(),
    pendingQuietMs: pending === 'absent' ? 0 : await quietMsOf(paths.pending, now),
    runningQuietMs: running === 'absent' ? 0 : await quietMsOf(paths.running, now),
  })
  if (action.act === 'launch') {
    // An interrupted run must not burn a Daz launch per remaining row just so
    // each script can notice the flag and skip: finish the batch here. The
    // finish report already never shows counts for an interrupted run.
    if (run.interrupted === true && pending !== 'absent' && pending !== null) {
      const finished = requeueCrashedBatch(pending, 'skipped — the export run was interrupted')
      const closed: ExporterJobFile = {
        ...finished.file,
        jobs: finished.file.jobs.map((job) =>
          job.status === 'pending'
            ? { ...job, status: 'failed' as const, error: 'skipped — the export run was interrupted' }
            : job,
        ),
        progress: 100,
      }
      closed.jobsDone = closed.jobs.filter(
        (j) => j.status === 'done' || j.status === 'failed',
      ).length
      await storage.writeTextFileAtomic(paths.running, jobFileTextOf(closed))
      await remove(paths.pending).catch(() => {})
      return
    }
    if (now - lastLaunchAt < LAUNCH_PACE_MS) return
    if (launches >= MAX_LAUNCHES_PER_BATCH) {
      await failRemainingRows(
        paths,
        pending,
        'Daz Studio kept exiting before it could run this row — the batch was stopped',
      )
      return
    }
    // A stale claimed file would block the fresh Runner's own claim rename —
    // the crash window between the requeue's write and its delete can leave
    // one. The Runner clears it too; being explicit here costs nothing.
    if (running !== 'absent') await remove(paths.running).catch(() => {})
    lastLaunchAt = now
    launches += 1
    await launchDazSceneless('visible')
    return
  }
  if (action.act === 'kill') {
    if (now - lastKillAt < KILL_PACE_MS) return
    lastKillAt = now
    await invoke('kill_daz_studio', { installFolder: await exportDazInstallFolder() })
      .then((raw) => z.number().parse(raw))
      .catch(() => 0)
    // The next tick sees the process gone and requeues the batch. A kill that
    // terminated nothing (an elevated Daz whose path can't be read) leaves
    // the state unchanged and simply retries at its own pace.
    return
  }
  if (action.act === 'requeue') {
    // The source is whichever file the rule judged: the parked pending
    // anomaly, else the claimed file of the crashed/killed session.
    if (pending !== 'absent' && pending !== null) {
      const { file } = requeueCrashedBatch(pending, action.reason)
      await storage.writeTextFileAtomic(paths.running, jobFileTextOf(file))
      await remove(paths.pending).catch(() => {})
      return
    }
    if (running !== 'absent' && running !== null) {
      const { file, workRemains } = requeueCrashedBatch(running, action.reason)
      if (workRemains) {
        // Pending first, claimed second: if the delete loses (a lock), the
        // Runner's pickup clears the stale claimed file itself.
        await storage.writeTextFileAtomic(paths.pending, jobFileTextOf(file))
        await remove(paths.running).catch(() => {})
      } else {
        await storage.writeTextFileAtomic(paths.running, jobFileTextOf(file))
      }
    }
  }
}

/** The loud give-up: every unworked row failed, progress 100 under the claimed
 *  name — the export watch reports the outcome like any finished batch. */
async function failRemainingRows(
  paths: { pending: string; running: string },
  pending: ReadFile,
  reason: string,
): Promise<void> {
  if (pending === 'absent' || pending === null) return
  const failed: ExporterJobFile = {
    ...pending,
    jobs: pending.jobs.map((job) =>
      job.status === 'pending' || job.status === 'running'
        ? { ...job, status: 'failed' as const, error: reason }
        : job,
    ),
    progress: 100,
  }
  failed.jobsDone = failed.jobs.length
  await storage.writeTextFileAtomic(paths.running, jobFileTextOf(failed))
  await remove(paths.pending).catch(() => {})
}
