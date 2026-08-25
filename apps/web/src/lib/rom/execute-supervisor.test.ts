import { describe, expect, it } from 'vitest'

import {
  SESSION_EXIT_TIMEOUT_MS,
  SESSION_PICKUP_GRACE_MS,
  SESSION_REQUEUE_GRACE_MS,
  SESSION_ROW_TIMEOUT_MS,
  batchPartiallyWorked,
  batchWorkRemains,
  jobFileJson,
  jobFileTextOf,
  parseJobFileJson,
  requeueCrashedBatch,
  superviseFreshSession,
} from './execute-jobs'
import type { ExporterJobEntry, ExporterJobFile } from './execute-jobs'

/**
 * The fresh-session-per-row supervision rule (contract v4) — every branch of
 * the pure decision the export supervisor executes. The scenarios mirror the
 * measured failure modes the orchestration exists for: the Runner quitting
 * between rows, a session crashing mid-row, the export teardown that hung
 * indefinitely, and a Daz that never manages to start.
 */

function batch(
  statuses: Array<ExporterJobEntry['status']>,
  over: Partial<ExporterJobFile> = {},
): ExporterJobFile {
  const processed = statuses.filter((s) => s === 'done' || s === 'failed').length
  return {
    version: 1,
    type: 'bulk-export',
    sessionPerRow: true,
    progress: Math.floor((processed * 100) / Math.max(1, statuses.length)),
    jobsDone: processed,
    jobs: statuses.map((status, i) => ({
      scenePath: `D:/scenes/scene${i}.duf`,
      scriptPath: 'D:/lib/.Bulk_ROM_Export.dsa',
      status,
    })),
    ...over,
  }
}

describe('sessionPerRow on the wire', () => {
  it('is written when asked for and round-trips the parse', () => {
    const text = jobFileJson(
      [{ scenePath: 'a.duf', scriptPath: 's.dsa' }],
      'bulk-export',
      'C:/log.txt',
      true,
    )
    const parsed = parseJobFileJson(text)
    expect(parsed?.sessionPerRow).toBe(true)
    // …and survives a studio-side rewrite verbatim.
    expect(parseJobFileJson(jobFileTextOf(parsed!))?.sessionPerRow).toBe(true)
  })

  it('is absent (not false) when not asked for — old batches stay old', () => {
    const text = jobFileJson([{ scenePath: 'a.duf', scriptPath: 's.dsa' }])
    expect(text).not.toContain('sessionPerRow')
    expect(parseJobFileJson(text)?.sessionPerRow).toBeUndefined()
  })
})

describe('superviseFreshSession', () => {
  const IDLE = { pendingQuietMs: 0, runningQuietMs: 0, msSinceLaunch: Number.POSITIVE_INFINITY }

  it('does nothing when no supervisable file exists', () => {
    expect(
      superviseFreshSession({ pending: 'absent', running: 'absent', dazRunning: false, ...IDLE }),
    ).toEqual({ act: 'none' })
  })

  it('ignores batches without the flag (old Runner rewrite dropped it)', () => {
    const plain = batch(['done', 'pending'])
    delete plain.sessionPerRow
    expect(
      superviseFreshSession({ pending: plain, running: 'absent', dazRunning: false, ...IDLE }),
    ).toEqual({ act: 'none' })
    expect(
      superviseFreshSession({ pending: 'absent', running: plain, dazRunning: false, ...IDLE }),
    ).toEqual({ act: 'none' })
  })

  it('launches the next session for a mid-batch pending file once Daz is gone', () => {
    expect(
      superviseFreshSession({
        pending: batch(['done', 'pending']),
        running: 'absent',
        dazRunning: false,
        ...IDLE,
      }),
    ).toEqual({ act: 'launch' })
  })

  it('waits while the previous session is still quitting — then kills it', () => {
    const parked = batch(['done', 'pending'])
    expect(
      superviseFreshSession({
        pending: parked,
        running: 'absent',
        dazRunning: true,
        pendingQuietMs: SESSION_EXIT_TIMEOUT_MS - 1,
        runningQuietMs: 0,
        msSinceLaunch: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ act: 'none' })
    expect(
      superviseFreshSession({
        pending: parked,
        running: 'absent',
        dazRunning: true,
        pendingQuietMs: SESSION_EXIT_TIMEOUT_MS + 1,
        runningQuietMs: 0,
        msSinceLaunch: Number.POSITIVE_INFINITY,
      }).act,
    ).toBe('kill')
    // The measured kill-loop regression: the pending file's mtime does not
    // change when a fresh session is LAUNCHED for it, so an old file plus a
    // young process must read as "starting", never "stuck exiting".
    expect(
      superviseFreshSession({
        pending: parked,
        running: 'absent',
        dazRunning: true,
        pendingQuietMs: SESSION_EXIT_TIMEOUT_MS + 1,
        runningQuietMs: 0,
        msSinceLaunch: 30_000,
      }),
    ).toEqual({ act: 'none' })
  })

  it('leaves an untouched pending handoff to the handoff flows, backstopping only a dead one', () => {
    const fresh = batch(['pending', 'pending'])
    // Daz up: the Runner (or the worn-session refusal) is acting.
    expect(
      superviseFreshSession({ pending: fresh, running: 'absent', dazRunning: true, ...IDLE }),
    ).toEqual({ act: 'none' })
    // Daz gone but within the grace: the handoff's own launch gets its chance.
    expect(
      superviseFreshSession({
        pending: fresh,
        running: 'absent',
        dazRunning: false,
        pendingQuietMs: SESSION_PICKUP_GRACE_MS - 1,
        runningQuietMs: 0,
        msSinceLaunch: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ act: 'none' })
    expect(
      superviseFreshSession({
        pending: fresh,
        running: 'absent',
        dazRunning: false,
        pendingQuietMs: SESSION_PICKUP_GRACE_MS + 1,
        runningQuietMs: 0,
        msSinceLaunch: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ act: 'launch' })
  })

  it('finishes a parked batch with nothing left to run (the double-rename crash anomaly)', () => {
    expect(
      superviseFreshSession({
        pending: batch(['done', 'failed']),
        running: 'absent',
        dazRunning: false,
        ...IDLE,
      }).act,
    ).toBe('requeue')
  })

  it('lets a live row run — and kills it past the hard row timeout', () => {
    const claimed = batch(['done', 'running'])
    expect(
      superviseFreshSession({
        pending: 'absent',
        running: claimed,
        dazRunning: true,
        pendingQuietMs: 0,
        runningQuietMs: SESSION_ROW_TIMEOUT_MS - 1,
        msSinceLaunch: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ act: 'none' })
    expect(
      superviseFreshSession({
        pending: 'absent',
        running: claimed,
        dazRunning: true,
        pendingQuietMs: 0,
        runningQuietMs: SESSION_ROW_TIMEOUT_MS + 1,
        msSinceLaunch: Number.POSITIVE_INFINITY,
      }).act,
    ).toBe('kill')
  })

  it('requeues a crashed session (claimed, Daz gone, below 100) after the grace', () => {
    const claimed = batch(['done', 'running', 'pending'])
    expect(
      superviseFreshSession({
        pending: 'absent',
        running: claimed,
        dazRunning: false,
        pendingQuietMs: 0,
        runningQuietMs: SESSION_REQUEUE_GRACE_MS - 1,
        msSinceLaunch: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ act: 'none' })
    expect(
      superviseFreshSession({
        pending: 'absent',
        running: claimed,
        dazRunning: false,
        pendingQuietMs: 0,
        runningQuietMs: SESSION_REQUEUE_GRACE_MS + 1,
        msSinceLaunch: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ act: 'requeue', reason: 'Daz Studio exited mid-row' })
  })

  it('never touches the reclaim path (claimed but untouched) or a finished file', () => {
    expect(
      superviseFreshSession({
        pending: 'absent',
        running: batch(['pending', 'pending']),
        dazRunning: false,
        pendingQuietMs: 0,
        runningQuietMs: SESSION_REQUEUE_GRACE_MS + 1,
        msSinceLaunch: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ act: 'none' })
    expect(
      superviseFreshSession({
        pending: 'absent',
        running: batch(['done', 'done'], { progress: 100 }),
        dazRunning: false,
        ...IDLE,
      }),
    ).toEqual({ act: 'none' })
  })
})

describe('requeueCrashedBatch', () => {
  it('fails the in-flight row, keeps the finished ones, hands back as pending', () => {
    const { file, workRemains } = requeueCrashedBatch(
      batch(['done', 'running', 'pending']),
      'Daz Studio exited mid-row',
    )
    expect(workRemains).toBe(true)
    expect(file.jobs.map((j) => j.status)).toEqual(['done', 'failed', 'pending'])
    expect(file.jobs[1].error).toBe('Daz Studio exited mid-row')
    expect(file.jobsDone).toBe(2)
    expect(file.progress).toBeLessThan(100)
    expect(file.sessionPerRow).toBe(true) // the flag survives the rewrite
  })

  it('finishes at 100 when the crashed row was the last', () => {
    const { file, workRemains } = requeueCrashedBatch(batch(['done', 'running']), 'x')
    expect(workRemains).toBe(false)
    expect(file.progress).toBe(100)
    expect(file.jobsDone).toBe(2)
  })
})

describe('row-state helpers', () => {
  it('classify worked and remaining rows', () => {
    expect(batchWorkRemains(batch(['done', 'pending']))).toBe(true)
    expect(batchWorkRemains(batch(['done', 'failed']))).toBe(false)
    expect(batchPartiallyWorked(batch(['pending', 'pending']))).toBe(false)
    expect(batchPartiallyWorked(batch(['failed', 'pending']))).toBe(true)
  })
})
