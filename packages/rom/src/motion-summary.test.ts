import { describe, expect, it } from 'vitest'

import {
  MOTION_DEGRADED_LOW_COUNT,
  motionGateVerdict,
  parseLastMotionSummary,
} from './motion-summary'

/**
 * Fixtures are VERBATIM blocks from the measured incident log
 * (D:/Perforce/…/Ita/houdini/daz-export/primary/Ita.log, 2026-08-24/25 —
 * DS4 4.24, exporter 2.1.9/2.1.10): the worst healthy run on record (Tear at
 * 60% of the figure — the calibration bound for the low-follower ratio), the
 * two measured degraded shapes (figure moving while followers freeze; the
 * figure itself half-frozen behind a livelier mouth), and the run that also
 * carried the exporter's own unchanged-frames warning. The thresholds in
 * motion-summary.ts are pinned against these — a threshold change that
 * reclassifies a measured run must fail here.
 */

const HEALTHY_WORST = `[2026-08-24 15:55:58] [INFO] Alembic ROM motion summary
[2026-08-24 15:55:58] [INFO]   Genesis 9: moved on 483 of 484 frames
[2026-08-24 15:55:58] [INFO]   Genesis 9 Eyes: moved on 374 of 484 frames
[2026-08-24 15:55:58] [INFO]   Genesis 9 Mouth: moved on 424 of 484 frames
[2026-08-24 15:55:58] [INFO]   Genesis 9 Tear: moved on 290 of 484 frames
[2026-08-24 15:55:58] [INFO]   GoldenPalaceG9_Shell_Majora: moved on 475 of 484 frames
[2026-08-24 15:55:58] [INFO]   GoldenPalaceG9_Shell_Minora: moved on 474 of 484 frames
[2026-08-24 15:55:58] [INFO]   GoldenPalace_G9: moved on 471 of 484 frames
[2026-08-24 15:55:58] [INFO]   PSAW Boots: moved on 483 of 484 frames
[2026-08-24 15:55:58] [INFO]   STX Gen 9 Nipples Feminine: moved on 476 of 484 frames
[2026-08-24 15:55:58] [INFO]   STX Genesis 9 Navel: moved on 470 of 484 frames
[2026-08-24 15:55:58] [INFO]   SU Yoga Clothes G9: moved on 480 of 484 frames
[2026-08-24 15:55:58] [INFO]   SU Yoga Pants G9: moved on 483 of 484 frames
[2026-08-24 15:55:58] [INFO] Writing alembic archive
`

const DEGRADED_FIGURE_MOVING = `[2026-08-25 12:01:57] [INFO] Alembic ROM motion summary
[2026-08-25 12:01:57] [INFO]   Genesis 9: moved on 464 of 484 frames
[2026-08-25 12:01:57] [INFO]   Genesis 9 Eyes: moved on 110 of 484 frames
[2026-08-25 12:01:57] [INFO]   Genesis 9 Mouth: moved on 344 of 484 frames
[2026-08-25 12:01:57] [INFO]   Genesis 9 Tear: moved on 109 of 484 frames
[2026-08-25 12:01:57] [INFO]   GoldenPalaceG9_Shell_Majora: moved on 156 of 484 frames
[2026-08-25 12:01:57] [INFO]   GoldenPalaceG9_Shell_Minora: moved on 156 of 484 frames
[2026-08-25 12:01:57] [INFO]   GoldenPalace_G9: moved on 151 of 484 frames
[2026-08-25 12:01:57] [INFO]   PSAW Boots: moved on 45 of 484 frames
[2026-08-25 12:01:57] [INFO]   STX Gen 9 Nipples Feminine: moved on 64 of 484 frames
[2026-08-25 12:01:57] [INFO]   STX Genesis 9 Navel: moved on 41 of 484 frames
[2026-08-25 12:01:57] [INFO]   SU Yoga Clothes G9: moved on 88 of 484 frames
[2026-08-25 12:01:57] [INFO]   SU Yoga Pants G9: moved on 83 of 484 frames
`

/** The figure itself half-frozen (131/484) behind a livelier mouth (335) —
 *  the reference must be the LIVELIEST node, not "the figure by name". */
const DEGRADED_FIGURE_FROZEN_TOO = `[2026-08-25 10:05:55] [INFO] Alembic ROM motion summary
[2026-08-25 10:05:55] [INFO]   Genesis 9: moved on 131 of 484 frames
[2026-08-25 10:05:55] [INFO]   Genesis 9 Eyes: moved on 110 of 484 frames
[2026-08-25 10:05:55] [INFO]   Genesis 9 Mouth: moved on 335 of 484 frames
[2026-08-25 10:05:55] [INFO]   Genesis 9 Tear: moved on 95 of 484 frames
[2026-08-25 10:05:55] [INFO]   GoldenPalaceG9_Shell_Majora: moved on 64 of 484 frames
[2026-08-25 10:05:55] [INFO]   GoldenPalaceG9_Shell_Minora: moved on 64 of 484 frames
[2026-08-25 10:05:55] [INFO]   GoldenPalace_G9: moved on 49 of 484 frames
[2026-08-25 10:05:55] [INFO]   PSAW Boots: moved on 45 of 484 frames
[2026-08-25 10:05:55] [INFO]   STX Gen 9 Nipples Feminine: moved on 63 of 484 frames
[2026-08-25 10:05:55] [INFO]   STX Genesis 9 Navel: moved on 38 of 484 frames
[2026-08-25 10:05:55] [INFO]   SU Yoga Clothes G9: moved on 77 of 484 frames
[2026-08-25 10:05:55] [INFO]   SU Yoga Pants G9: moved on 74 of 484 frames
[2026-08-25 10:05:55] [INFO] Writing alembic archive
`

/** 2.1.10's own warning rides right before its summary block (measured: the
 *  only run of twelve that printed it was degraded). */
const DEGRADED_WITH_WARNING = `[2026-08-25 13:11:26] [WARNING] 472 of 483 frames left at least one mesh unchanged
[2026-08-25 13:11:26] [INFO] Alembic ROM motion summary
[2026-08-25 13:11:26] [INFO]   Genesis 9: moved on 464 of 484 frames
[2026-08-25 13:11:26] [INFO]   Genesis 9 Eyes: moved on 110 of 484 frames
[2026-08-25 13:11:26] [INFO]   GoldenPalace_G9: moved on 151 of 484 frames
`

const STATUE = `[2026-08-25 09:36:46] [INFO] Alembic ROM motion summary
[2026-08-25 09:36:46] [INFO]   Genesis 9: moved on 0 of 484 frames
[2026-08-25 09:36:46] [INFO]   Genesis 9 Mouth: moved on 0 of 484 frames
[2026-08-25 09:36:46] [INFO]   PSAW Boots: moved on 0 of 484 frames
`

describe('parseLastMotionSummary', () => {
  it('parses every node line of the measured healthy block', () => {
    const summary = parseLastMotionSummary(HEALTHY_WORST)
    expect(summary?.nodes).toHaveLength(12)
    expect(summary?.nodes[0]).toEqual({ node: 'Genesis 9', moved: 483, total: 484 })
    expect(summary?.nodes[4]).toEqual({
      node: 'GoldenPalaceG9_Shell_Majora',
      moved: 475,
      total: 484,
    })
    expect(summary?.unchangedFrames).toBeNull()
  })

  it('takes the LAST block of an accreting log, not the first', () => {
    const summary = parseLastMotionSummary(DEGRADED_FIGURE_MOVING + HEALTHY_WORST)
    expect(summary?.nodes[1]).toEqual({ node: 'Genesis 9 Eyes', moved: 374, total: 484 })
  })

  it('associates the unchanged-frames warning with ITS block only', () => {
    const withWarning = parseLastMotionSummary(DEGRADED_WITH_WARNING)
    expect(withWarning?.unchangedFrames).toEqual({ affected: 472, total: 483 })
    // The warning belongs to the FIRST block here — a later block without one
    // must not inherit it.
    const later = parseLastMotionSummary(DEGRADED_WITH_WARNING + HEALTHY_WORST)
    expect(later?.unchangedFrames).toBeNull()
  })

  it('returns null for a log without a summary (older exporter)', () => {
    expect(parseLastMotionSummary('[2026-08-25] [INFO] doExport triggered\n')).toBeNull()
    expect(parseLastMotionSummary('')).toBeNull()
  })
})

describe('motionGateVerdict', () => {
  it('clears the worst measured healthy run (Tear at 60% of the figure)', () => {
    const verdict = motionGateVerdict(parseLastMotionSummary(HEALTHY_WORST))
    expect(verdict.degraded).toBe(false)
    expect(verdict.low).toHaveLength(0)
    expect(verdict.reference?.node).toBe('Genesis 9')
  })

  it('fails the measured moving-figure degradation (nine frozen followers)', () => {
    const verdict = motionGateVerdict(parseLastMotionSummary(DEGRADED_FIGURE_MOVING))
    expect(verdict.degraded).toBe(true)
    expect(verdict.low.length).toBeGreaterThanOrEqual(MOTION_DEGRADED_LOW_COUNT)
    expect(verdict.low.map((n) => n.node)).toContain('Genesis 9 Eyes')
    expect(verdict.reasons.join(' ')).toContain('staleness')
  })

  it('fails the frozen-figure shape via the liveliest-node reference', () => {
    const verdict = motionGateVerdict(parseLastMotionSummary(DEGRADED_FIGURE_FROZEN_TOO))
    expect(verdict.degraded).toBe(true)
    expect(verdict.reference?.node).toBe('Genesis 9 Mouth')
    // The half-frozen FIGURE itself counts among the low nodes here.
    expect(verdict.low.map((n) => n.node)).toContain('Genesis 9')
  })

  it("fails on the exporter's own unchanged-frames warning", () => {
    const verdict = motionGateVerdict(parseLastMotionSummary(DEGRADED_WITH_WARNING))
    expect(verdict.degraded).toBe(true)
    expect(verdict.reasons.some((r) => r.includes('472 of 483'))).toBe(true)
  })

  it('fails the total statue', () => {
    const verdict = motionGateVerdict(parseLastMotionSummary(STATUE))
    expect(verdict.degraded).toBe(true)
    expect(verdict.reasons.join(' ')).toContain('statue')
  })

  it('a single static prop does not fail a healthy export', () => {
    const oneProp =
      `[x] [INFO] Alembic ROM motion summary\n` +
      `[x] [INFO]   Genesis 9: moved on 480 of 484 frames\n` +
      `[x] [INFO]   Some Prop: moved on 3 of 484 frames\n` +
      `[x] [INFO]   SU Yoga Pants G9: moved on 471 of 484 frames\n`
    const verdict = motionGateVerdict(parseLastMotionSummary(oneProp))
    expect(verdict.degraded).toBe(false)
    expect(verdict.low).toHaveLength(1)
  })

  it('gates nothing without a summary', () => {
    const verdict = motionGateVerdict(null)
    expect(verdict.degraded).toBe(false)
    expect(verdict.reasons).toHaveLength(0)
  })
})
