import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { backupsIn } from './shared.ts'
import { materialUtilReportSchema } from '#/lib/rom/api/native-types.ts'

// `backupsIn` is the drawer's only route from a run report to the copies it
// left on disk: what it misses is never offered for restore and never cleared
// on the way out. It works by spreading each per-project result list BY NAME,
// so a new operation is one line away from being invisible here — and unlike
// the Python, the Rust struct, the zod schema and the fixture (all of which
// fail loudly when a new op is missed), this one just returns fewer rows.
//
// So the fixture decides, not a hand-kept list. `contracts/material-util-report.json`
// is the shared wire format and the convention is that a new structured return
// adds its section there; this walks whatever sections it finds and demands one
// row per non-empty `backupPath`. Adding an op without teaching `backupsIn`
// about it fails right here.
//
// Measured: this is exactly how `retarget` shipped missing — five of the six
// lists were spread, and nothing said so.

const FIXTURE = new URL('../../../../../../contracts/material-util-report.json', import.meta.url)

interface BackupRow {
  hipPath: string
  backupPath: string
}

/** Every `backupPath` the fixture carries, found by walking its own array
 *  fields rather than by naming them — that is the whole point. */
function backupsInFixture(wire: Record<string, unknown>): Array<BackupRow> {
  const out: Array<BackupRow> = []
  for (const value of Object.values(wire)) {
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Partial<BackupRow>
      if (typeof row.backupPath !== 'string' || row.backupPath === '') continue
      out.push({ hipPath: row.hipPath ?? '', backupPath: row.backupPath })
    }
  }
  return out
}

describe('backupsIn', () => {
  const wire = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>
  const report = materialUtilReportSchema.parse(wire)

  it('finds every backup the shared fixture reports, from every operation', () => {
    const expected = backupsInFixture(wire)
    // Sanity on the fixture itself: a section that stopped carrying backups
    // would make this test pass by asking for nothing.
    expect(expected.length).toBeGreaterThan(0)
    expect(backupsIn(report).map((row) => row.backupPath).sort()).toEqual(
      expected.map((row) => row.backupPath).sort(),
    )
  })

  it('drops the entries that wrote no copy — a dry run, and a run that changed nothing', () => {
    // `defaults` and `refresh` both carry an entry with an empty backupPath in
    // the fixture, which is what those two states look like on the wire.
    expect(backupsIn(report).every((row) => row.backupPath !== '')).toBe(true)
  })

  it('carries each entry’s own hipPath and ok through', () => {
    const retarget = backupsIn(report).find((row) => row.backupPath.includes('Nova_dthbak'))
    expect(retarget).toEqual({
      hipPath: 'D:/chars/Nova/houdini/Nova.hiplc',
      backupPath: 'D:/chars/Nova/houdini/backup/Nova_dthbak.hiplc',
      ok: true,
    })
  })
})
