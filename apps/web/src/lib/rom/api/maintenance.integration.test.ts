// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'

vi.mock('../storage', () => ({ dataPath: vi.fn(async () => 'C:/appdata/product-scans') }))
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
  it('invokes housekeeping_sweep with the scans dir + retention and sums the result', async () => {
    let payload: Record<string, unknown> | null = null
    mockIPC((cmd, p) => {
      expect(cmd).toBe('housekeeping_sweep')
      payload = p as Record<string, unknown>
      return { filesDeleted: 7, bytesFreed: 4096 }
    })

    const result = await housekeepingSweep()

    expect(payload!.request).toMatchObject({ productScansDir: 'C:/appdata/product-scans' })
    expect((payload!.request as { maxAgeDays: number }).maxAgeDays).toBeGreaterThan(0)
    // scans (7/4096) + note-media (0/0)
    expect(result).toEqual({ filesDeleted: 7, bytesFreed: 4096 })
  })

  it('THROWS if the native return drifts from the HousekeepingResult schema', async () => {
    mockIPC(() => ({ filesDeleted: 'lots' })) // wrong type + missing bytesFreed
    await expect(housekeepingSweep()).rejects.toThrow()
  })
})
