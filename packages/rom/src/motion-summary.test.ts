import { describe, expect, it } from 'vitest'

import {
  MOTION_DEGRADED_COLLAPSE_COUNT,
  motionGateVerdict,
  parseLastMotionSummary,
  parseMotionSummaries,
} from './motion-summary'

/**
 * Fixtures are VERBATIM blocks from the measured incident logs (Ita.log and
 * the naked-G9 test scene's NakedG9_FemaleG9Naked.log, 2026-08-24/25 — DS4
 * 4.24, exporter 2.1.9/2.1.10). The history gate's thresholds are pinned
 * against them — a change that reclassifies a measured run must fail here.
 *
 * The naked-scene pair is the reason the gate is HISTORICAL: its healthy
 * exports carry facial followers at 66–123 of 433 frames (the ROM never
 * animates the face), which any figure-relative rule reads as frozen — the
 * false positive measured live on 2026-08-25 and fixed by judging each node
 * against its own earlier best instead.
 */

const ITA_HEALTHY = `[2026-08-24 15:55:58] [INFO] Alembic ROM motion summary
[2026-08-24 15:55:58] [INFO]   Genesis 9: moved on 483 of 484 frames
[2026-08-24 15:55:58] [INFO]   Genesis 9 Eyes: moved on 374 of 484 frames
[2026-08-24 15:55:58] [INFO]   Genesis 9 Mouth: moved on 424 of 484 frames
[2026-08-24 15:55:58] [INFO]   Genesis 9 Tear: moved on 477 of 484 frames
[2026-08-24 15:55:58] [INFO]   GoldenPalaceG9_Shell_Majora: moved on 475 of 484 frames
[2026-08-24 15:55:58] [INFO]   GoldenPalace_G9: moved on 471 of 484 frames
[2026-08-24 15:55:58] [INFO]   PSAW Boots: moved on 483 of 484 frames
[2026-08-24 15:55:58] [INFO] Writing alembic archive
`

/** The worst measured HEALTHY follower: Tear at 290/484 = 61% of its 477 best. */
const ITA_HEALTHY_WORST = `[2026-08-25 11:45:12] [INFO] Alembic ROM motion summary
[2026-08-25 11:45:12] [INFO]   Genesis 9: moved on 483 of 484 frames
[2026-08-25 11:45:12] [INFO]   Genesis 9 Eyes: moved on 374 of 484 frames
[2026-08-25 11:45:12] [INFO]   Genesis 9 Mouth: moved on 424 of 484 frames
[2026-08-25 11:45:12] [INFO]   Genesis 9 Tear: moved on 290 of 484 frames
[2026-08-25 11:45:12] [INFO]   GoldenPalaceG9_Shell_Majora: moved on 475 of 484 frames
[2026-08-25 11:45:12] [INFO]   GoldenPalace_G9: moved on 471 of 484 frames
[2026-08-25 11:45:12] [INFO]   PSAW Boots: moved on 483 of 484 frames
`

const ITA_DEGRADED = `[2026-08-25 12:01:57] [INFO] Alembic ROM motion summary
[2026-08-25 12:01:57] [INFO]   Genesis 9: moved on 464 of 484 frames
[2026-08-25 12:01:57] [INFO]   Genesis 9 Eyes: moved on 110 of 484 frames
[2026-08-25 12:01:57] [INFO]   Genesis 9 Mouth: moved on 344 of 484 frames
[2026-08-25 12:01:57] [INFO]   Genesis 9 Tear: moved on 109 of 484 frames
[2026-08-25 12:01:57] [INFO]   GoldenPalaceG9_Shell_Majora: moved on 156 of 484 frames
[2026-08-25 12:01:57] [INFO]   GoldenPalace_G9: moved on 151 of 484 frames
[2026-08-25 12:01:57] [INFO]   PSAW Boots: moved on 45 of 484 frames
`

/** Healthy fresh-session naked-G9 export (2026-08-25 17:37): face followers
 *  legitimately low, GP shells near the figure. */
const NAKED_HEALTHY_1 = `[2026-08-25 17:37:46] [INFO] Alembic ROM motion summary
[2026-08-25 17:37:46] [INFO]   G9 Eyebrows Card Style 06: moved on 123 of 433 frames
[2026-08-25 17:37:46] [INFO]   Genesis 9: moved on 432 of 433 frames
[2026-08-25 17:37:46] [INFO]   Genesis 9 Eyelashes: moved on 99 of 433 frames
[2026-08-25 17:37:46] [INFO]   Genesis 9 Eyes: moved on 94 of 433 frames
[2026-08-25 17:37:46] [INFO]   Genesis 9 Mouth: moved on 74 of 433 frames
[2026-08-25 17:37:46] [INFO]   Genesis 9 Tear: moved on 99 of 433 frames
[2026-08-25 17:37:46] [INFO]   GoldenPalaceG9_Shell_Majora: moved on 426 of 433 frames
[2026-08-25 17:37:46] [INFO]   GoldenPalaceG9_Shell_Minora: moved on 426 of 433 frames
[2026-08-25 17:37:46] [INFO]   GoldenPalace_G9: moved on 424 of 433 frames
`

const NAKED_HEALTHY_2 = `[2026-08-25 17:47:15] [INFO] Alembic ROM motion summary
[2026-08-25 17:47:15] [INFO]   G9 Eyebrows Card Style 06: moved on 115 of 433 frames
[2026-08-25 17:47:15] [INFO]   Genesis 9: moved on 422 of 433 frames
[2026-08-25 17:47:15] [INFO]   Genesis 9 Eyelashes: moved on 89 of 433 frames
[2026-08-25 17:47:15] [INFO]   Genesis 9 Eyes: moved on 85 of 433 frames
[2026-08-25 17:47:15] [INFO]   Genesis 9 Mouth: moved on 66 of 433 frames
[2026-08-25 17:47:15] [INFO]   Genesis 9 Tear: moved on 89 of 433 frames
[2026-08-25 17:47:15] [INFO]   GoldenPalaceG9_Shell_Majora: moved on 422 of 433 frames
[2026-08-25 17:47:15] [INFO]   GoldenPalaceG9_Shell_Minora: moved on 422 of 433 frames
[2026-08-25 17:47:15] [INFO]   GoldenPalace_G9: moved on 413 of 433 frames
`

/** The measured degraded naked run (16:06, same session re-load): GP frozen
 *  at 116–119 while the face counts are the SAME as in healthy runs. */
const NAKED_DEGRADED = `[2026-08-25 16:06:14] [INFO] Alembic ROM motion summary
[2026-08-25 16:06:14] [INFO]   G9 Eyebrows Card Style 06: moved on 123 of 433 frames
[2026-08-25 16:06:14] [INFO]   Genesis 9: moved on 413 of 433 frames
[2026-08-25 16:06:14] [INFO]   Genesis 9 Eyelashes: moved on 99 of 433 frames
[2026-08-25 16:06:14] [INFO]   Genesis 9 Eyes: moved on 94 of 433 frames
[2026-08-25 16:06:14] [INFO]   Genesis 9 Mouth: moved on 74 of 433 frames
[2026-08-25 16:06:14] [INFO]   Genesis 9 Tear: moved on 99 of 433 frames
[2026-08-25 16:06:14] [INFO]   GoldenPalaceG9_Shell_Majora: moved on 119 of 433 frames
[2026-08-25 16:06:14] [INFO]   GoldenPalaceG9_Shell_Minora: moved on 119 of 433 frames
[2026-08-25 16:06:14] [INFO]   GoldenPalace_G9: moved on 116 of 433 frames
`

const STATUE = `[2026-08-25 09:36:46] [INFO] Alembic ROM motion summary
[2026-08-25 09:36:46] [INFO]   Genesis 9: moved on 0 of 484 frames
[2026-08-25 09:36:46] [INFO]   Genesis 9 Mouth: moved on 0 of 484 frames
[2026-08-25 09:36:46] [INFO]   PSAW Boots: moved on 0 of 484 frames
`

describe('parseMotionSummaries', () => {
  it('parses every block of an accreting log, in order', () => {
    const all = parseMotionSummaries(ITA_HEALTHY + ITA_DEGRADED + NAKED_HEALTHY_1)
    expect(all).toHaveLength(3)
    expect(all[0].nodes[0]).toEqual({ node: 'Genesis 9', moved: 483, total: 484 })
    expect(all[2].nodes).toHaveLength(9)
    expect(parseLastMotionSummary(ITA_HEALTHY + ITA_DEGRADED)?.nodes[1]).toEqual({
      node: 'Genesis 9 Eyes',
      moved: 110,
      total: 484,
    })
  })

  it('returns nothing for a log without a summary (older exporter)', () => {
    expect(parseMotionSummaries('[2026-08-25] [INFO] doExport triggered\n')).toHaveLength(0)
    expect(parseLastMotionSummary('')).toBeNull()
  })
})

describe('motionGateVerdict (the history gate)', () => {
  it('fails the measured Ita degradation against its healthy history', () => {
    const verdict = motionGateVerdict(parseMotionSummaries(ITA_HEALTHY + ITA_DEGRADED))
    expect(verdict.degraded).toBe(true)
    expect(verdict.collapsed.length).toBeGreaterThanOrEqual(MOTION_DEGRADED_COLLAPSE_COUNT)
    expect(verdict.collapsed.map((n) => n.node)).toContain('Genesis 9 Eyes')
    expect(verdict.reasons.join(' ')).toContain('staleness')
  })

  it('clears the worst measured healthy run (Tear at 61% of its best)', () => {
    const verdict = motionGateVerdict(parseMotionSummaries(ITA_HEALTHY + ITA_HEALTHY_WORST))
    expect(verdict.degraded).toBe(false)
    expect(verdict.collapsed).toHaveLength(0)
  })

  it('clears healthy naked-scene runs despite legitimately still faces', () => {
    // The false positive measured live: face followers at 15–28% of the
    // figure on a HEALTHY export. Against their own history they are steady.
    const verdict = motionGateVerdict(parseMotionSummaries(NAKED_HEALTHY_1 + NAKED_HEALTHY_2))
    expect(verdict.degraded).toBe(false)
    expect(verdict.collapsed).toHaveLength(0)
  })

  it('fails the measured naked-scene degradation (GP collapsing, face unchanged)', () => {
    const verdict = motionGateVerdict(parseMotionSummaries(NAKED_HEALTHY_1 + NAKED_DEGRADED))
    expect(verdict.degraded).toBe(true)
    expect(verdict.collapsed.map((n) => n.node).sort()).toEqual([
      'GoldenPalaceG9_Shell_Majora',
      'GoldenPalaceG9_Shell_Minora',
      'GoldenPalace_G9',
    ])
  })

  it('a degraded run cannot poison the baseline for a later healthy one', () => {
    const verdict = motionGateVerdict(
      parseMotionSummaries(NAKED_HEALTHY_1 + NAKED_DEGRADED + NAKED_HEALTHY_2),
    )
    expect(verdict.degraded).toBe(false)
  })

  it('gates nothing without history — a first export has no evidence', () => {
    const verdict = motionGateVerdict(parseMotionSummaries(ITA_DEGRADED))
    expect(verdict.degraded).toBe(false)
    expect(verdict.collapsed).toHaveLength(0)
  })

  it('fails the total statue even without history', () => {
    const verdict = motionGateVerdict(parseMotionSummaries(STATUE))
    expect(verdict.degraded).toBe(true)
    expect(verdict.reasons.join(' ')).toContain('statue')
  })

  it('a single collapsed node does not fail the run', () => {
    const before =
      `[x] [INFO] Alembic ROM motion summary\n` +
      `[x] [INFO]   Genesis 9: moved on 480 of 484 frames\n` +
      `[x] [INFO]   Some Cloth: moved on 470 of 484 frames\n`
    const after =
      `[x] [INFO] Alembic ROM motion summary\n` +
      `[x] [INFO]   Genesis 9: moved on 480 of 484 frames\n` +
      `[x] [INFO]   Some Cloth: moved on 30 of 484 frames\n`
    const verdict = motionGateVerdict(parseMotionSummaries(before + after))
    expect(verdict.degraded).toBe(false)
    expect(verdict.collapsed).toHaveLength(1)
  })

  it('nodes without history (renamed/new items) are never counted', () => {
    const before =
      `[x] [INFO] Alembic ROM motion summary\n` +
      `[x] [INFO]   Genesis 9: moved on 480 of 484 frames\n`
    const after =
      `[x] [INFO] Alembic ROM motion summary\n` +
      `[x] [INFO]   Genesis 9: moved on 478 of 484 frames\n` +
      `[x] [INFO]   Brand New Cloth: moved on 3 of 484 frames\n` +
      `[x] [INFO]   Other New Cloth: moved on 5 of 484 frames\n`
    const verdict = motionGateVerdict(parseMotionSummaries(before + after))
    expect(verdict.degraded).toBe(false)
  })

  it('gates nothing on an empty parse', () => {
    expect(motionGateVerdict([]).degraded).toBe(false)
  })
})
