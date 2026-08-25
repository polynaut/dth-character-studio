import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

/**
 * dthMotionSummaryVerdict (runtime v102) — parsing the DTH Exporter's own
 * "Alembic ROM motion summary" (exporter >= 2.1.9) out of its per-character
 * log. The summary is the ONLY artifact that tells a real export from a
 * statue: alembics are not bit-reproducible and size is not a health metric.
 *
 * The fixtures are the measured blocks from the 2026-08-25 incident (Ita/G9,
 * DS4 4.24): a healthy run (best node 483/484), the deterministic partial
 * staleness (best node 335/484 ≈ 69%) and the total statue (0/484 everywhere,
 * 23 MB alembic reported as success — which also purged the previous good
 * set's backups; the carrier gate this feeds exists so that never repeats).
 *
 * The shipped `DthUtils.dsa` runs for real in a sandbox (same harness as
 * dialed-walked-gate.test.ts); DzFile is faked to serve the fixture text.
 */

const HEADER = (stamp: string) => `[${stamp}] [INFO] Alembic ROM motion summary\n`

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

interface Verdict {
  nodes: number
  zero: number
  best: number
  lines: Array<string>
}

interface UtilsModule {
  dthMotionSummaryVerdict: (path: string) => Verdict | null
}

/** Load DthUtils.dsa with a DzFile fake serving `files[path]`. */
function loadUtils(files: Record<string, string>): UtilsModule {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const src = readFileSync(join(dir, 'DthUtils.dsa'), 'utf8')
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
    `${src}\n;({ dthMotionSummaryVerdict: dthMotionSummaryVerdict })`,
    {
      print: () => {},
      Math,
      Date,
      JSON,
      DzFile: FakeDzFile,
      DzFloatProperty: { LINEAR_INTERP: 0, CONSTANT_INTERP: 1, TCB_INTERP: 2 },
      DzProperty: { InterpLinear: 0, InterpConstant: 1 },
      Scene: {
        setDefaultKeyInterpolationType: () => {},
        getTimeStep: () => 160,
      },
    },
  ) as UtilsModule
}

describe('dthMotionSummaryVerdict', () => {
  it('reads a healthy summary: all nodes counted, none zero, best ≈ 1', () => {
    const utils = loadUtils({ 'X:/e/Ita.log': `preamble noise\n${HEALTHY}trailer noise\n` })
    const v = utils.dthMotionSummaryVerdict('X:/e/Ita.log')
    expect(v).not.toBeNull()
    expect(v!.nodes).toBe(4)
    expect(v!.zero).toBe(0)
    expect(v!.best).toBeCloseTo(483 / 484, 5)
    expect(v!.lines[0]).toBe('Genesis 9: moved on 483 of 484 frames')
  })

  it('flags the measured statue: every node zero (zero == nodes)', () => {
    const utils = loadUtils({ 'X:/e/Ita.log': STATUE })
    const v = utils.dthMotionSummaryVerdict('X:/e/Ita.log')
    expect(v!.nodes).toBe(3)
    expect(v!.zero).toBe(3)
    expect(v!.best).toBe(0)
  })

  it('measures the partial staleness by its best node (≈69%, below the 90% carrier threshold)', () => {
    const utils = loadUtils({ 'X:/e/Ita.log': PARTIAL })
    const v = utils.dthMotionSummaryVerdict('X:/e/Ita.log')
    expect(v!.nodes).toBe(3)
    expect(v!.zero).toBe(0)
    expect(v!.best).toBeCloseTo(335 / 484, 5)
    expect(v!.best).toBeLessThan(0.9)
  })

  it('reads the LAST summary when the log holds several runs', () => {
    // The exporter appends — one log carries every run of that scene. The
    // verdict must describe the run that JUST finished, not an older one.
    const utils = loadUtils({ 'X:/e/Ita.log': HEALTHY + 'between runs\n' + STATUE })
    const v = utils.dthMotionSummaryVerdict('X:/e/Ita.log')
    expect(v!.zero).toBe(3)
    expect(v!.zero).toBe(v!.nodes)
  })

  it('returns null on a missing file, a summary-less log, and a header with no node lines — no evidence gates nothing', () => {
    const utils = loadUtils({
      'X:/e/no-summary.log': 'lines\nwithout\nany summary\n',
      'X:/e/bare-header.log': HEADER('2026-08-25 12:00:00') + 'next run started\n',
    })
    expect(utils.dthMotionSummaryVerdict('X:/e/missing.log')).toBeNull()
    expect(utils.dthMotionSummaryVerdict('X:/e/no-summary.log')).toBeNull()
    expect(utils.dthMotionSummaryVerdict('X:/e/bare-header.log')).toBeNull()
  })
})
