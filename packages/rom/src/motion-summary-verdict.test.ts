import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { MOTION_SUMMARY_HELPER } from './dsa'

/**
 * The motion audit (runtime v102) — parsing the DTH Exporter's own "Alembic
 * ROM motion summary" (exporter >= 2.1.9) out of its per-character log. The
 * summary is the ONLY artifact that tells a real export from a statue:
 * alembics are not bit-reproducible and size is not a health metric.
 *
 * The fixtures are the measured blocks from the 2026-08-25 incident (Ita/G9,
 * DS4 4.24): a healthy run (best node 483/484), the deterministic partial
 * staleness (best node 335/484 ~ 69%) and the total statue (0/484 everywhere,
 * 23 MB alembic reported as success — which also purged the previous good
 * set's backups; the carrier gate this feeds exists so that never repeats).
 *
 * The subject is the CARRIER text itself (`MOTION_SUMMARY_HELPER`), run in a
 * sandbox with DzFile faked — not a copy of it, and not a runtime file. The
 * helper lives in the carrier precisely because the export-only carriers
 * include no runtime at all; see dsa-syntax.test.ts's runtime-less pin.
 */

const HEADER = (stamp: string) => `[${stamp}] [INFO] Alembic ROM motion summary
`

const HEALTHY =
  HEADER('2026-08-25 07:41:57') +
  `[2026-08-25 07:41:57] [INFO]   Genesis 9: moved on 483 of 484 frames
[2026-08-25 07:41:57] [INFO]   Genesis 9 Eyes: moved on 374 of 484 frames
[2026-08-25 07:41:57] [INFO]   Genesis 9 Mouth: moved on 424 of 484 frames
[2026-08-25 07:41:57] [INFO]   PSAW Boots: moved on 483 of 484 frames
`

const PARTIAL =
  HEADER('2026-08-25 10:29:20') +
  `[2026-08-25 10:29:20] [INFO]   Genesis 9: moved on 131 of 484 frames
[2026-08-25 10:29:20] [INFO]   Genesis 9 Mouth: moved on 335 of 484 frames
[2026-08-25 10:29:20] [INFO]   PSAW Boots: moved on 45 of 484 frames
`

const STATUE =
  HEADER('2026-08-25 09:36:46') +
  `[2026-08-25 09:36:46] [INFO]   Genesis 9: moved on 0 of 484 frames
[2026-08-25 09:36:46] [INFO]   Genesis 9 Mouth: moved on 0 of 484 frames
[2026-08-25 09:36:46] [INFO]   PSAW Boots: moved on 0 of 484 frames
`

/** A healthy SHORT rom: 9 of 10 frames is the best a 10-frame walk reaches. */
const SHORT_HEALTHY =
  HEADER('2026-08-25 11:00:00') +
  `[2026-08-25 11:00:00] [INFO]   Genesis 9: moved on 9 of 10 frames
[2026-08-25 11:00:00] [INFO]   PSAW Boots: moved on 8 of 10 frames
`

const SHORT_STALE =
  HEADER('2026-08-25 11:30:00') +
  `[2026-08-25 11:30:00] [INFO]   Genesis 9: moved on 4 of 10 frames
`

interface Verdict {
  nodes: number
  zero: number
  best: number
  bestTotal: number
  lines: Array<string>
}

interface Helper {
  dthMotionLogMark: (path: string) => number
  dthMotionSummaryVerdict: (path: string, from?: number) => Verdict | null
  dthMotionSuspect: (verdict: Verdict | null) => boolean
}

/** Run the carrier helper text with a DzFile fake serving `files[path]`. */
function load(files: Record<string, string>): Helper {
  class FakeDzFile {
    path: string
    ReadOnly = 1
    constructor(path: string) {
      this.path = path
    }
    open(_mode: number) {
      return files[this.path] !== undefined
    }
    read() {
      return files[this.path]
    }
    close() {}
  }
  return runInNewContext(
    `${MOTION_SUMMARY_HELPER};({ dthMotionLogMark: dthMotionLogMark,` +
      ` dthMotionSummaryVerdict: dthMotionSummaryVerdict,` +
      ` dthMotionSuspect: dthMotionSuspect })`,
    { DzFile: FakeDzFile, Math, JSON, print: () => {} },
  ) as Helper
}

const LOG = 'X:/e/Ita.log'

describe('dthMotionSummaryVerdict', () => {
  it('reads a healthy summary: all nodes counted, none zero, best ~ 1', () => {
    const h = load({ [LOG]: `preamble noise\n${HEALTHY}trailer noise\n` })
    const v = h.dthMotionSummaryVerdict(LOG)
    expect(v).not.toBeNull()
    expect(v!.nodes).toBe(4)
    expect(v!.zero).toBe(0)
    expect(v!.best).toBeCloseTo(483 / 484, 5)
    expect(v!.bestTotal).toBe(484)
    expect(v!.lines[0]).toBe('Genesis 9: moved on 483 of 484 frames')
  })

  it('flags the measured statue: every node zero (zero == nodes)', () => {
    const v = load({ [LOG]: STATUE }).dthMotionSummaryVerdict(LOG)
    expect(v!.nodes).toBe(3)
    expect(v!.zero).toBe(3)
    expect(v!.best).toBe(0)
  })

  it('measures the partial staleness by its best node (~69%)', () => {
    const v = load({ [LOG]: PARTIAL }).dthMotionSummaryVerdict(LOG)
    expect(v!.nodes).toBe(3)
    expect(v!.zero).toBe(0)
    expect(v!.best).toBeCloseTo(335 / 484, 5)
  })

  it('reads the LAST summary when the log holds several runs', () => {
    // The exporter appends — one log carries every run of that scene. The
    // verdict must describe the run that JUST finished, not an older one.
    const v = load({ [LOG]: `${HEALTHY}between runs\n${STATUE}` }).dthMotionSummaryVerdict(LOG)
    expect(v!.zero).toBe(v!.nodes)
  })

  it('returns null on a missing file, a summary-less log, and a header with no node lines', () => {
    const h = load({
      'X:/e/no-summary.log': 'lines\nwithout\nany summary\n',
      'X:/e/bare-header.log': `${HEADER('2026-08-25 12:00:00')}next run started\n`,
    })
    expect(h.dthMotionSummaryVerdict('X:/e/missing.log')).toBeNull()
    expect(h.dthMotionSummaryVerdict('X:/e/no-summary.log')).toBeNull()
    expect(h.dthMotionSummaryVerdict('X:/e/bare-header.log')).toBeNull()
  })
})

/**
 * The MARK — only a summary THIS export wrote may judge it.
 *
 * The exporter appends to one per-character log, and that log is not part of
 * the set the sweep moves aside (`dthOwnSetFile` lists the .dth/.abc/.fbx/.csv,
 * never the .log), so every earlier run's block survives in the file. Without
 * the mark, a run that wrote no summary of its own — an older exporter, or one
 * that died after the .dth landed — is judged by an OLDER run's block, and a
 * stale all-zero one would discard a perfectly good export.
 */
describe('the pre-export mark', () => {
  it('ignores a summary that predates the export (the stale-verdict trap)', () => {
    // The two phases the carrier really runs in: mark, export, verdict. The
    // log already holds an older run's STATUE block when the export starts.
    const files: Record<string, string> = { [LOG]: STATUE }
    const h = load(files)
    const mark = h.dthMotionLogMark(LOG)
    expect(mark).toBe(STATUE.length)
    files[LOG] = `${STATUE}the export ran and wrote no summary of its own\n`
    // Judged on its own evidence this export has none, so it gates nothing —
    // instead of inheriting the previous run's statue and being discarded.
    expect(h.dthMotionSummaryVerdict(LOG, mark)).toBeNull()
  })

  it('accepts a summary written past the mark', () => {
    const files: Record<string, string> = { [LOG]: STATUE }
    const h = load(files)
    const mark = h.dthMotionLogMark(LOG)
    files[LOG] = STATUE + HEALTHY
    const v = h.dthMotionSummaryVerdict(LOG, mark)
    expect(v!.zero).toBe(0)
    expect(v!.best).toBeCloseTo(483 / 484, 5)
  })

  it('treats a log that SHRANK as all new (rotated or truncated)', () => {
    const h = load({ [LOG]: HEALTHY })
    expect(h.dthMotionSummaryVerdict(LOG, 999999)!.nodes).toBe(4)
  })

  it('marks a log that does not exist yet as 0', () => {
    expect(load({}).dthMotionLogMark(LOG)).toBe(0)
  })
})

/**
 * The soft bar. A healthy run's best node is NOT 100% — the measured healthy
 * best was 483 of 484, one frame short of the walk. On a long ROM that frame
 * is noise; on a short one it is the whole margin, so a flat 0.9 would file
 * "do not trust this export set" on every healthy export of a 10-frame ROM.
 */
describe('dthMotionSuspect', () => {
  it('clears the measured healthy run and condemns the measured partial one', () => {
    const healthy = load({ [LOG]: HEALTHY })
    const partial = load({ [LOG]: PARTIAL })
    expect(healthy.dthMotionSuspect(healthy.dthMotionSummaryVerdict(LOG))).toBe(false)
    expect(partial.dthMotionSuspect(partial.dthMotionSummaryVerdict(LOG))).toBe(true)
  })

  it('does not condemn a healthy SHORT rom for the frame a long one also misses', () => {
    const h = load({ [LOG]: SHORT_HEALTHY })
    const v = h.dthMotionSummaryVerdict(LOG)
    // 9/10 = 0.9 exactly — a flat 0.9 bar is a coin flip on it; the scaled bar
    // (90% of the reachable 9/10) leaves real headroom.
    expect(v!.best).toBe(0.9)
    expect(h.dthMotionSuspect(v)).toBe(false)
  })

  it('still condemns a genuinely stale SHORT rom', () => {
    const h = load({ [LOG]: SHORT_STALE })
    expect(h.dthMotionSuspect(h.dthMotionSummaryVerdict(LOG))).toBe(true)
  })

  it('says nothing when there is no verdict', () => {
    expect(load({}).dthMotionSuspect(null)).toBe(false)
  })
})
