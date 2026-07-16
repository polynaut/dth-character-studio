// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'

vi.mock('../storage', () => ({
  dataPath: vi.fn(async () => 'C:/appdata/product-scans'),
  scanFramesDir: vi.fn(async () => 'C:/appdata/scan-frames'),
}))
// No projects to sweep -> the note-media half contributes {0,0}, isolating the
// native `housekeeping_sweep` invoke as the thing under test.
vi.mock('./core', () => ({ projectsForSweep: vi.fn(async () => []) }))
vi.mock('./notes', () => ({ gcNoteMedia: vi.fn(async () => ({ filesDeleted: 0, bytesFreed: 0 })) }))

import { housekeepingSweep } from './maintenance.ts'

// housekeepingSweep no-ops in a plain browser (`isTauri()` reads
// `globalThis.isTauri`); mark the env as Tauri so the invoke path runs.
beforeEach(() => {
  ;(globalThis as { isTauri?: boolean }).isTauri = true
})
afterEach(() => {
  clearMocks()
  vi.clearAllMocks()
  delete (globalThis as { isTauri?: boolean }).isTauri
})

describe('housekeepingSweep — FFI request shape + return validation', () => {
  it('invokes housekeeping_sweep for BOTH scan roots with a retention and sums the result', async () => {
    const payloads: Array<Record<string, unknown>> = []
    mockIPC((cmd, p) => {
      expect(cmd).toBe('housekeeping_sweep')
      payloads.push(p as Record<string, unknown>)
      return { filesDeleted: 7, bytesFreed: 4096 }
    })

    const result = await housekeepingSweep()

    // One sweep per app-data scan root: product scans, then Scan_Frames CSVs.
    expect(payloads.map((p) => (p.request as { productScansDir: string }).productScansDir)).toEqual(
      ['C:/appdata/product-scans', 'C:/appdata/scan-frames'],
    )
    for (const p of payloads) {
      expect((p.request as { maxAgeDays: number }).maxAgeDays).toBeGreaterThan(0)
    }
    // product scans (7/4096) + scan-frames (7/4096) + note-media (0/0)
    expect(result).toEqual({ filesDeleted: 14, bytesFreed: 8192 })
  })

  it('THROWS if the native return drifts from the HousekeepingResult schema', async () => {
    mockIPC(() => ({ filesDeleted: 'lots' })) // wrong type + missing bytesFreed
    await expect(housekeepingSweep()).rejects.toThrow()
  })
})
