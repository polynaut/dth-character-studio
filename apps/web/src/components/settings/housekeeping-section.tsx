import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup } from '@dth/ui'
import {
  housekeepingSweep,
  NOTE_MEDIA_RETENTION_DAYS,
  PRODUCT_SCAN_RETENTION_DAYS,
  SCAN_FRAMES_RETENTION_DAYS,
} from '#/lib/rom/api.ts'

/** Human-readable byte size (e.g. 1536 → "1.5 KB"), for the housekeeping readout. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

/**
 * "Storage & housekeeping" section (Settings → App Data) — a "Clean up now"
 * sweep that ages out stale product-scan files, Scan_Frames CSVs and
 * unreferenced note media. The same sweep runs automatically on every launch.
 */
export function HousekeepingSection() {
  const [cleanupBusy, setCleanupBusy] = useState(false)

  async function onCleanupNow() {
    setCleanupBusy(true)
    try {
      const result = await housekeepingSweep()
      toast.success(
        result.filesDeleted > 0
          ? `Freed ${formatBytes(result.bytesFreed)} — removed ${result.filesDeleted} stale file(s)`
          : 'Nothing to clean up — no stale scans or unused note media',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setCleanupBusy(false)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div>
        <h2 className="flex w-fit items-center gap-1 font-semibold">
          Storage &amp; housekeeping
          <InfoPopup label="Storage & housekeeping — more information">
            The studio ages out its own generated data so it can't fill your disk.
            Per-scene <strong>product-scan</strong> files are deleted automatically once
            they're older than <strong>{PRODUCT_SCAN_RETENTION_DAYS} days</strong> (also on
            every launch); deleting a character removes its scan data right away.{' '}
            <strong>Scan_Frames</strong> keyframe CSVs age out after{' '}
            <strong>{SCAN_FRAMES_RETENTION_DAYS} days</strong> (re-run the script to
            reproduce one). Dropped <strong>note media</strong> no notes reference anymore
            is removed after <strong>{NOTE_MEDIA_RETENTION_DAYS} days</strong> (saving notes
            already cleans up after an hour).
          </InfoPopup>
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Reclaim space from the studio's own generated data.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void onCleanupNow()} disabled={cleanupBusy}>
          <Trash2 /> {cleanupBusy ? 'Working…' : 'Clean up now'}
        </Button>
        <span className="text-sm text-muted-foreground">
          Age out product-scan files and Scan_Frames CSVs older than{' '}
          {PRODUCT_SCAN_RETENTION_DAYS} days and unreferenced note media older than{' '}
          {NOTE_MEDIA_RETENTION_DAYS} days.
        </span>
      </div>
    </section>
  )
}
