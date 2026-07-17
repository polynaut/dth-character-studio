import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { RUNTIME_VERSION } from '@dth/rom'
import { describe, expect, it } from 'vitest'

// The DTH Daz runtime (.dsa) is bundled + installed by the studio; it descends
// from soltude/DazToHue-Scripts but is studio-owned now (the upstream twin-sync
// ended when the repo went dormant). Nothing else guards against an ACCIDENTAL
// edit to the bundled copy. This test pins a hash of the runtime so any change
// is deliberate:
//
//   When you intentionally change a runtime file you MUST, together:
//     1. update EXPECTED_RUNTIME_HASH below to the value this test prints,
//     2. bump RUNTIME_VERSION in packages/rom/src/types.ts (so Refresh assets
//        reinstalls the runtime + regenerates character scripts).
//
// A silent edit that skips either is exactly what this catches.

const RUNTIME_FILES = [
  'DthWorkflow.dsa',
  'DthUtils.dsa',
  'DthOptions.dsa',
  'DthProducts.dsa',
  'DthScanMorphs.dsa',
  'DthScanFrames.dsa',
  'Scan_Morphs_G9.dsa',
  'Scan_Morphs_G8.1.dsa',
  'Scan_Morphs_G8.dsa',
  'Scan_Morphs_G3.dsa',
  'Scan_Frames.dsa',
]

// Bump this together with RUNTIME_VERSION whenever a runtime file legitimately
// changes (this run prints the new value in the failure message).
const EXPECTED_RUNTIME_HASH = '1532227ffbda72f4b841ff927cf89a99534e596617cc998d381dab17a772f278'

function runtimeHash(): string {
  const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
  const h = createHash('sha256')
  for (const file of RUNTIME_FILES) {
    h.update(file)
    // Normalise CRLF → LF so a line-ending flip on checkout doesn't false-fail.
    h.update(readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n'))
  }
  return h.digest('hex')
}

describe('bundled DTH runtime (.dsa)', () => {
  it('has not changed without bumping RUNTIME_VERSION + updating the hash', () => {
    const actual = runtimeHash()
    expect(
      actual,
      `The bundled runtime .dsa files changed. If intentional: set EXPECTED_RUNTIME_HASH = "${actual}" and bump RUNTIME_VERSION (currently ${RUNTIME_VERSION}) in packages/rom/src/types.ts.`,
    ).toBe(EXPECTED_RUNTIME_HASH)
  })

  // The core-invariant guard: preset-block lengths must be MEASURED (threaded in as
  // options.presetFrames), never hard-coded. A literal frame count in the runtime is
  // exactly how the Daz timeline could silently drift from the PoseAsset CSV.
  it('sizes every preset block from measured presetFrames — no hard-coded frame count', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'runtime')
    const workflow = readFileSync(join(dir, 'DthWorkflow.dsa'), 'utf8')
    // No numeric literal assigned to a *FrameCount var, and no `iRomFrames = 328 : 617`.
    expect(workflow).not.toMatch(/FrameCount\s*=\s*\d/)
    expect(workflow).not.toMatch(/iRomFrames\s*=\s*[^;\n]*\d/)
    expect(workflow).not.toMatch(/\?\s*328\s*:\s*617/)
    // Each block reads its measured length via the fail-loud helper instead.
    for (const key of ['base', 'gp', 'dk', 'phys']) {
      expect(workflow).toContain(`getPresetFrameCount(options, "${key}")`)
    }
  })
})
