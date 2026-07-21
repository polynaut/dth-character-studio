import { describe, expect, it } from 'vitest'

import {
  dedupReportSchema,
  housekeepingResultSchema,
  installReportSchema,
} from './native-types.ts'

// These schemas are the runtime guard at the Rust→TS invoke boundary (parsed in
// install.ts / maintenance.ts). They must accept exactly what the serde structs
// serialize; a drift throws in the app. These fixtures mirror the camelCase JSON
// the Rust side emits — if a Rust field is renamed, update BOTH sides.

describe('installReportSchema', () => {
  it('accepts a full report incl. optional filesList/note on a step', () => {
    const wire = {
      dryRun: true,
      totalFiles: 3,
      steps: [
        { label: 'Genesis 9', files: 3, status: 'ok', detail: 'copied', filesList: ['a', 'b'] },
        { label: 'header', files: 0, status: 'header', detail: '' },
      ],
    }
    expect(installReportSchema.parse(wire)).toEqual(wire)
  })

  it('rejects an unknown status enum value', () => {
    const bad = { dryRun: false, totalFiles: 0, steps: [{ label: 'x', files: 0, status: 'boom', detail: '' }] }
    expect(() => installReportSchema.parse(bad)).toThrow()
  })

  it('rejects a missing required field (would silently be undefined with a bare cast)', () => {
    expect(() => installReportSchema.parse({ dryRun: false, steps: [] })).toThrow()
  })
})

describe('dedupReportSchema', () => {
  it('accepts a report with a version duplicate group + a shared-file conflict', () => {
    const wire = {
      dryRun: false,
      assetsQuarantined: 1,
      backupDir: 'X:/q',
      conflicts: [{ rel: 'data/x.dsf', copies: [{ label: 'A', source: '_g9', size: 10, inZip: false }] }],
      duplicates: [
        {
          kind: 'version',
          fixed: true,
          members: [
            {
              label: 'A UD',
              source: '_g9',
              path: 'X:/assets/_g9/A UD',
              fileCount: 5,
              isZip: false,
              isKeeper: true,
              moved: false,
              error: '',
            },
          ],
        },
      ],
      errors: ['Chosen keeper no longer found: X:/assets/_g9/Old — re-scan.'],
    }
    expect(dedupReportSchema.parse(wire)).toEqual(wire)
  })

  it('rejects a member without its identifying path (label keys collide in exact groups)', () => {
    const bad = {
      dryRun: true,
      assetsQuarantined: 0,
      backupDir: '',
      conflicts: [],
      errors: [],
      duplicates: [
        {
          kind: 'exact',
          fixed: false,
          members: [{ label: 'A', source: '_g9', fileCount: 1, isZip: false, isKeeper: true, moved: false, error: '' }],
        },
      ],
    }
    expect(() => dedupReportSchema.parse(bad)).toThrow()
  })
})

describe('housekeepingResultSchema', () => {
  it('accepts a sweep result', () => {
    expect(housekeepingResultSchema.parse({ filesDeleted: 4, bytesFreed: 2048 })).toEqual({
      filesDeleted: 4,
      bytesFreed: 2048,
    })
  })
})
