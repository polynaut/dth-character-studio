import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { projectsForSweep } from './core'
import { gcNoteMedia } from './notes'
import { housekeepingResultSchema, remapResultSchema } from './native-types.ts'
// Inferred from the zod schemas (parsed at the invoke boundary below) + re-exported.
import type { HousekeepingResult, RemapResult } from './native-types.ts'
export type { HousekeepingResult, RemapResult }

// --- Housekeeping: keep app-generated data from filling the disk -------------
// Product-scan CSVs (one per Daz scene, app-data) age out after
// PRODUCT_SCAN_RETENTION_DAYS; the Scan_Frames keyframe CSVs (also one per Daz
// scene) after SCAN_FRAMES_RETENTION_DAYS; unreferenced note media ages out
// after NOTE_MEDIA_RETENTION_DAYS (the save-time GC usually gets there first);
// the dedup quarantine (large, reversible backup) is only ever emptied on the
// user's explicit request. deleteCharacter also prunes a character's scan
// folder + avatar so nothing orphans going forward.

/** Days a product-scan file is kept before the launch/manual sweep ages it out. */
export const PRODUCT_SCAN_RETENTION_DAYS = 30

/** Days a Scan_Frames keyframe CSV is kept before the sweep ages it out —
 *  scans are cheap to reproduce (re-run the script on the scene). */
export const SCAN_FRAMES_RETENTION_DAYS = 30

/** Days an unreferenced note-media file is kept before the sweep removes it. */
export const NOTE_MEDIA_RETENTION_DAYS = 7

/**
 * Backstop for the save-time note-media GC: for every known project, delete
 * media files no notes file references anymore, once they're older than
 * NOTE_MEDIA_RETENTION_DAYS. Covers projects whose notes are never saved
 * again. A missing/offline project dir contributes nothing (skipped silently).
 */
export async function sweepNoteMedia(): Promise<HousekeepingResult> {
  const total: HousekeepingResult = { filesDeleted: 0, bytesFreed: 0 }
  for (const project of await projectsForSweep()) {
    try {
      const freed = await gcNoteMedia(project.path, NOTE_MEDIA_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      total.filesDeleted += freed.filesDeleted
      total.bytesFreed += freed.bytesFreed
    } catch {
      // an unreachable project — contributes nothing this sweep
    }
  }
  return total
}

/**
 * Age-out stale app-data scan files (not modified within their retention
 * windows) — the `product-scans` root and the `scan-frames` keyframe CSVs —
 * pruning folders they empty, plus the note-media sweep across all known
 * projects. Runs on app launch and from the Tools "Clean up now" button.
 * No-op in the plain web build (no native layer).
 */
export async function housekeepingSweep(): Promise<HousekeepingResult> {
  if (!isTauri()) return { filesDeleted: 0, bytesFreed: 0 }
  const media = await sweepNoteMedia()
  const productScansDir = await storage.dataPath('product-scans')
  const scans = housekeepingResultSchema.parse(
    await invoke('housekeeping_sweep', {
      request: { productScansDir, maxAgeDays: PRODUCT_SCAN_RETENTION_DAYS },
    }),
  )
  // Same age-out for the Scan_Frames CSVs — the sweep command is generic over
  // its root, so it bounds this folder too.
  const frames = housekeepingResultSchema.parse(
    await invoke('housekeeping_sweep', {
      request: {
        productScansDir: await storage.scanFramesDir(),
        maxAgeDays: SCAN_FRAMES_RETENTION_DAYS,
      },
    }),
  )
  return {
    filesDeleted: scans.filesDeleted + frames.filesDeleted + media.filesDeleted,
    bytesFreed: scans.bytesFreed + frames.bytesFreed + media.bytesFreed,
    // Locked/readonly files past the cutoff that could NOT be deleted — summed
    // across both native sweeps so "0 files freed" is distinguishable from
    // "every delete failed" (the note-media GC reports no failures).
    filesFailed: (scans.filesFailed ?? 0) + (frames.filesFailed ?? 0),
  }
}

// --- Network drives -------------------------------------------------------

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
    // Parsed at the boundary (never a bare invoke<T>() cast) — the shape is
    // pinned by contracts/remap-results.json on both sides.
    return z.array(remapResultSchema).parse(await invoke('ensure_network_drives', { mappings }))
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
