import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  dedupReportSchema,
  housekeepingResultSchema,
  installReportSchema,
  poseAssetFramesSchema,
} from './native-types.ts'

// FFI contract tests — the TS half. The shared fixtures under `contracts/`
// (repo root) ARE the wire format of the structured command returns:
// apps/desktop/src/contract_tests.rs round-trips each one through the serde
// structs, and this file parses the SAME bytes through the zod schemas the api
// layer validates with. Green on both sides = Rust and TS agree on the wire
// format; a field rename on either side fails its half. Adding a structured
// command return = add a fixture + a case on BOTH sides.

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../../../../contracts/${name}`, import.meta.url), 'utf8'))

const CASES = [
  ['pose-asset-frames.json', z.array(poseAssetFramesSchema)],
  ['sweep-report.json', housekeepingResultSchema],
  ['install-report.json', installReportSchema],
  ['dedup-report.json', dedupReportSchema],
] as const

describe('native FFI contract fixtures', () => {
  for (const [name, schema] of CASES) {
    it(`${name} parses UNCHANGED through the zod schema`, () => {
      const wire = fixture(name)
      // parse() strips unknown keys, so toEqual(wire) also catches a fixture
      // field the schema would silently ignore — not just missing/mistyped ones.
      expect(schema.parse(wire)).toEqual(wire)
    })
  }
})
