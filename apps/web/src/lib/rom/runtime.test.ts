import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { RUNTIME_VERSION } from '@dth/rom'
import { describe, expect, it } from 'vitest'

// The DTH Daz runtime (.dsa) is co-owned: it lives here (bundled + installed by
// the studio) AND as a byte-synced twin in the DazToHue-Scripts repo, kept in
// sync by hand. Nothing else guards against an ACCIDENTAL edit to the bundled
// copy. This test pins a hash of the runtime so any change is deliberate:
//
//   When you intentionally change a runtime file you MUST, together:
//     1. update EXPECTED_RUNTIME_HASH below to the value this test prints,
//     2. bump RUNTIME_VERSION in packages/rom/src/types.ts (so Refresh assets
//        reinstalls the runtime + regenerates character scripts),
//     3. mirror the change into the DazToHue-Scripts checkout
//        (see the dth-runtime-sync-workflow — diff --strip-trailing-cr).
//
// A silent edit that skips any of these is exactly what this catches.

const RUNTIME_FILES = ['DthWorkflow.dsa', 'DthUtils.dsa', 'DthOptions.dsa', 'DthProducts.dsa']

// Bump this together with RUNTIME_VERSION whenever a runtime file legitimately
// changes (this run prints the new value in the failure message).
const EXPECTED_RUNTIME_HASH = '0e49cac31745664286b1d31ef80a4b92e26fb02c6ae9d932e25bb99dc1a34bbd'

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
      `The bundled runtime .dsa files changed. If intentional: set EXPECTED_RUNTIME_HASH = "${actual}", bump RUNTIME_VERSION (currently ${RUNTIME_VERSION}) in packages/rom/src/types.ts, and mirror into DazToHue-Scripts.`,
    ).toBe(EXPECTED_RUNTIME_HASH)
  })
})
