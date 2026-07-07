import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'

// --- Housekeeping: keep app-generated data from filling the disk -------------
// Product-scan CSVs (one per Daz scene, app-data) age out after
// PRODUCT_SCAN_RETENTION_DAYS; the dedup quarantine (large, reversible backup) is
// only ever emptied on the user's explicit request. deleteCharacter also prunes a
// character's scan folder + avatar so nothing orphans going forward.

/** Days a product-scan file is kept before the launch/manual sweep ages it out. */
export const PRODUCT_SCAN_RETENTION_DAYS = 30

/** Files + bytes removed by a housekeeping action. */
export interface HousekeepingResult {
  filesDeleted: number
  bytesFreed: number
}

/**
 * Age-out stale product-scan files (not modified within the retention window)
 * under the app-data `product-scans` root, pruning folders they empty. Runs on
 * app launch and from the Tools "Clean up now" button. No-op in the plain web
 * build (no native layer).
 */
export async function housekeepingSweep(): Promise<HousekeepingResult> {
  if (!isTauri()) return { filesDeleted: 0, bytesFreed: 0 }
  const productScansDir = await storage.dataPath('product-scans')
  return invoke<HousekeepingResult>('housekeeping_sweep', {
    request: { productScansDir, maxAgeDays: PRODUCT_SCAN_RETENTION_DAYS },
  })
}

/** The dedup quarantine folder's file count + size (Tools readout). Zeroed when
 *  no quarantine folder is configured or the app has no native layer. */
export async function quarantineStats(): Promise<{
  exists: boolean
  files: number
  bytes: number
}> {
  const { dedupQuarantineFolder } = await storage.getSettings()
  if (!isTauri() || !dedupQuarantineFolder.trim()) return { exists: false, files: 0, bytes: 0 }
  return invoke('folder_stats', { path: dedupQuarantineFolder })
}

/** Empty the dedup quarantine folder's contents — the user's manual "reclaim this
 *  backup" action. Callers MUST confirm first: this permanently deletes the
 *  moved-aside duplicate assets (they can be re-created by re-running dedup). */
export async function emptyQuarantine(): Promise<HousekeepingResult> {
  const { dedupQuarantineFolder } = await storage.getSettings()
  if (!dedupQuarantineFolder.trim()) throw new Error('No quarantine folder is set.')
  return invoke<HousekeepingResult>('empty_folder', { path: dedupQuarantineFolder })
}

// --- Network drives -------------------------------------------------------

/** Outcome of trying to ensure one known network drive is mapped (mirrors Rust). */
export interface RemapResult {
  drive: string
  unc: string
  status: 'already' | 'remapped' | 'conflict' | 'failed' | 'unsupported'
  detail: string
}

/** UNC a mapped network drive points to ("X:\…" → "\\host\share"), or '' when
 *  the path isn't on a (mapped) network drive / the native command is absent. */
export async function uncForPath(path: string): Promise<string> {
  try {
    return (await invoke<string | null>('unc_for_path', { path })) ?? ''
  } catch {
    return ''
  }
}

/**
 * If `path` lives on a mapped network drive, remember that drive→UNC mapping so
 * it can be re-mapped later (e.g. after relaunching elevated). Fire-and-forget,
 * called as folders/files are picked; a no-op off Windows / in web-only mode.
 */
export async function rememberNetworkPath(path: string): Promise<void> {
  if (!path || path[1] !== ':') return
  const unc = await uncForPath(path)
  if (unc) await storage.rememberDrive(path.slice(0, 2), unc)
}

/** Re-map any known network drives that aren't currently available. Runs on
 *  startup; returns a per-drive report. No-op (empty) off Windows / web-only. */
export async function ensureNetworkDrives(): Promise<Array<RemapResult>> {
  try {
    const mappings = await storage.listKnownDrives()
    if (mappings.length === 0) return []
    return await invoke<Array<RemapResult>>('ensure_network_drives', { mappings })
  } catch {
    return []
  }
}

export async function fetchKnownDrives(): Promise<Array<storage.KnownDrive>> {
  return storage.listKnownDrives()
}

export async function forgetNetworkDrive({ data }: { data: unknown }): Promise<void> {
  await storage.forgetDrive(z.object({ drive: z.string().min(1) }).parse(data).drive)
}
