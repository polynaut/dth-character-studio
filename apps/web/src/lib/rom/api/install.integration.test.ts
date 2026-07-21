// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks'

// Mock the storage layer so these tests exercise ONLY the FFI boundary — the
// request shape sent over `invoke` and the zod validation of the return — not
// the filesystem underneath. mockIPC intercepts the `invoke` call itself.
vi.mock('../storage', () => ({
  getSettings: vi.fn(),
  dataPath: vi.fn(async () => 'C:/appdata'),
}))

import * as storage from '../storage'
import { dedupDazAssets, uninstallDaz } from './install.ts'

const getSettings = storage.getSettings as unknown as ReturnType<typeof vi.fn>

afterEach(() => {
  clearMocks()
  vi.clearAllMocks()
})

describe('uninstallDaz — FFI request shape + return validation', () => {
  it('invokes uninstall_daz with trimmed/filtered folders and parses the InstallReport', async () => {
    getSettings.mockResolvedValue({ dazUninstallFolders: ['  C:/a  ', '', 'C:/b'] })
    let captured: { cmd: string; payload: unknown } | null = null
    mockIPC((cmd, payload) => {
      captured = { cmd, payload }
      return { dryRun: true, totalFiles: 2, steps: [{ label: 'x', files: 2, status: 'ok', detail: '' }] }
    })

    const report = await uninstallDaz({ data: { dryRun: true } })

    expect(captured!.cmd).toBe('uninstall_daz')
    // whitespace trimmed, empties dropped — the exact contract the Rust command expects.
    expect(captured!.payload).toEqual({ request: { folders: ['C:/a', 'C:/b'], dryRun: true } })
    expect(report.totalFiles).toBe(2)
    expect(report.steps[0]).toMatchObject({ status: 'ok', files: 2 })
  })

  it('THROWS if the native return drifts from the schema (a renamed/missing field)', async () => {
    getSettings.mockResolvedValue({ dazUninstallFolders: ['C:/a'] })
    // Missing `totalFiles` — a bare invoke<T>() cast would silently hand the UI
    // `undefined`; the zod parse must throw AT the boundary instead.
    mockIPC(() => ({ dryRun: true, steps: [] }))
    await expect(uninstallDaz({ data: {} })).rejects.toThrow()
  })

  it('rejects an out-of-range status enum from Rust', async () => {
    getSettings.mockResolvedValue({ dazUninstallFolders: ['C:/a'] })
    mockIPC(() => ({ dryRun: false, totalFiles: 0, steps: [{ label: 'x', files: 0, status: 'weird', detail: '' }] }))
    await expect(uninstallDaz({ data: {} })).rejects.toThrow()
  })

  it('throws (does not invoke) when there are no folders to clean', async () => {
    getSettings.mockResolvedValue({ dazUninstallFolders: [] })
    let invoked = false
    mockIPC(() => {
      invoked = true
      return { dryRun: true, totalFiles: 0, steps: [] }
    })
    await expect(uninstallDaz({ data: {} })).rejects.toThrow(/no folders/i)
    expect(invoked).toBe(false)
  })
})

describe('dedupDazAssets — FFI request shape + DedupReport validation', () => {
  it('invokes dedup_daz_assets with the sources/accepted/quarantine and parses the report', async () => {
    getSettings.mockResolvedValue({
      dazAssetsFolders: ['  X:/assets  ', ''],
      acceptedConflicts: ['some/file'],
      dedupQuarantineFolder: '  Q:/q  ',
    })
    let payload: Record<string, unknown> | null = null
    mockIPC((cmd, p) => {
      expect(cmd).toBe('dedup_daz_assets')
      payload = p as Record<string, unknown>
      return {
        dryRun: true,
        conflicts: [],
        duplicates: [],
        assetsQuarantined: 0,
        backupDir: 'Q:/q',
        errors: [],
      }
    })

    const report = await dedupDazAssets({ data: { dryRun: true } })

    expect(payload!.request).toMatchObject({
      sources: ['X:/assets'],
      dryRun: true,
      accepted: ['some/file'],
      quarantine: 'Q:/q',
    })
    expect(report.backupDir).toBe('Q:/q')
  })

  it('throws when no assets folder is configured (no invoke)', async () => {
    getSettings.mockResolvedValue({ dazAssetsFolders: [], acceptedConflicts: [], dedupQuarantineFolder: '' })
    await expect(dedupDazAssets({ data: {} })).rejects.toThrow(/at least one/i)
  })
})
