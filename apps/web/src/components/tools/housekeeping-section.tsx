import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup } from '@dth/ui'
import {
  emptyQuarantine,
  housekeepingSweep,
  NOTE_MEDIA_RETENTION_DAYS,
  PRODUCT_SCAN_RETENTION_DAYS,
} from '#/lib/rom/api.ts'
import { displayPath } from '#/lib/path.ts'
import { PathCode } from '#/components/path-code.tsx'

/** Human-readable byte size (e.g. 1536 → "1.5 KB"), for the housekeeping readouts. */
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
 * "Storage & housekeeping" section — a "Clean up now" sweep (age out stale
 * product-scan files + unreferenced note media) and the dedup-quarantine size
 * readout with an "Empty quarantine" action. Owns its own busy / confirm state;
 * the quarantine stats + reload live in the parent (the dedup Apply also refreshes
 * them via `onReloadStats`).
 */
export function HousekeepingSection({
  quarantineFolder,
  quarantine,
  onReloadStats,
}: {
  quarantineFolder: string
  quarantine: { files: number; bytes: number } | null
  onReloadStats: () => Promise<void>
}) {
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [emptyConfirm, setEmptyConfirm] = useState(false)

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
  async function onEmptyQuarantine() {
    setEmptyConfirm(false)
    setCleanupBusy(true)
    try {
      const result = await emptyQuarantine()
      toast.success(`Emptied quarantine — freed ${formatBytes(result.bytesFreed)}`)
      await onReloadStats()
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
            every launch); deleting a character removes its scan data right away. Dropped{' '}
            <strong>note media</strong> no notes reference anymore is removed after{' '}
            <strong>{NOTE_MEDIA_RETENTION_DAYS} days</strong> (saving notes already cleans up
            after an hour). The dedup <strong>quarantine</strong> is your reversible backup,
            so it's only ever emptied when you ask.
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
          Age out product-scan files older than {PRODUCT_SCAN_RETENTION_DAYS} days and
          unreferenced note media older than {NOTE_MEDIA_RETENTION_DAYS} days.
        </span>
      </div>

      <div className="border-t pt-4">
        <p className="text-sm font-medium">Dedup quarantine</p>
        {quarantineFolder.trim() ? (
          quarantine && quarantine.files > 0 ? (
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {formatBytes(quarantine.bytes)} in {quarantine.files} file(s) at{' '}
                <PathCode path={displayPath(quarantineFolder)} />
              </span>
              {emptyConfirm ? (
                <span className="flex items-center gap-2">
                  <span className="text-sm">Permanently delete the quarantined copies?</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void onEmptyQuarantine()}
                    disabled={cleanupBusy}
                  >
                    Yes, empty it
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEmptyConfirm(false)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEmptyConfirm(true)}
                  disabled={cleanupBusy}
                >
                  <Trash2 /> Empty quarantine
                </Button>
              )}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Empty — nothing to reclaim.</p>
          )
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            No quarantine folder set (see Deduplicate above).
          </p>
        )}
      </div>
    </section>
  )
}
