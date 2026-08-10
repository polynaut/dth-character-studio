import { useCallback, useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup, useRefetchOnFocus } from '@dth/ui'
import {
  clearExporterJobFiles,
  ExporterJobFilesChangedError,
  exporterJobFilesSignature,
  fetchExporterJobFiles,
  housekeepingSweep,
  NOTE_MEDIA_RETENTION_DAYS,
  PRODUCT_SCAN_RETENTION_DAYS,
  SCAN_FRAMES_RETENTION_DAYS,
} from '#/lib/rom/api.ts'
import { formatAgo } from '#/lib/rom/execute-jobs.ts'

import type { ExporterJobFileState } from '#/lib/rom/api.ts'

/**
 * What one job file IS, in a line — the difference between clearing litter and
 * taking a batch away from the Daz that is running it.
 */
function jobFileSummary(file: ExporterJobFileState): string {
  const rows = file.jobs > 0 ? `${file.jobs} job${file.jobs === 1 ? '' : 's'}` : 'unreadable'
  const what =
    file.kind === 'pending'
      ? 'written, never claimed — waiting for Daz Studio'
      : file.progress >= 100
        ? 'claimed and finished — leftover'
        : `claimed by the Runner — ${file.progress}% done`
  return `${what} · ${rows} · ${formatAgo(file.ageMs)}`
}

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
 * unreferenced note media (the same sweep runs automatically on every launch),
 * plus the manual clear for a stranded DTH Exporter job file.
 *
 * The job file is the odd one out here: it is not app data aging out, it is ONE
 * file in the Daz library that every later export and scan refuses to write
 * over ("a batch is waiting for Daz Studio"). Nothing else in the app can
 * remove it once no character owns it anymore — Abort lives on the character
 * that started the batch, and a batch that was never started has no such page.
 */
export function HousekeepingSection() {
  const [cleanupBusy, setCleanupBusy] = useState(false)
  // The last manual sweep's could-not-delete count — kept as a persistent line
  // under the button (the warning toast above vanishes on its own, and a
  // failure that will simply be retried shouldn't only exist for 4 seconds).
  const [lastFailed, setLastFailed] = useState(0)
  const [jobFiles, setJobFiles] = useState<Array<ExporterJobFileState>>([])
  // A failed read must not render as "nothing there" — that is the one answer
  // this readout must never give wrongly.
  const [jobFilesError, setJobFilesError] = useState('')
  /** '' = the confirm is closed; otherwise the signature of the state the user
   *  agreed to delete. Kept rather than a boolean because the file can change
   *  under an open confirm (the Runner claims it inside Daz, whatever this
   *  window is doing), and "yes, delete" must not survive that. */
  const [confirmSig, setConfirmSig] = useState('')
  const [clearing, setClearing] = useState(false)

  const loadJobFiles = useCallback(async () => {
    try {
      const files = await fetchExporterJobFiles()
      setJobFiles(files)
      setJobFilesError('')
      // A confirm that no longer describes what is on disk is withdrawn — the
      // amber "may be live" warning is the safety on this action, and it is
      // computed from the state shown, not the state deleted.
      setConfirmSig((sig) => (sig && sig !== exporterJobFilesSignature(files) ? '' : sig))
      return files
    } catch (e) {
      setJobFilesError(e instanceof Error ? e.message : String(e))
      return null
    }
  }, [])

  /** Arm the confirm on a FRESH read, so the warning the user weighs is the
   *  current one rather than whatever the last focus happened to catch. */
  async function onAskClear() {
    const files = await loadJobFiles()
    if (files && files.length > 0) setConfirmSig(exporterJobFilesSignature(files))
  }

  // On mount and on every refocus: the interesting change (Daz claimed the
  // batch, or died holding it) happens while this window is in the background.
  useRefetchOnFocus(
    () => {
      void loadJobFiles()
    },
    [loadJobFiles],
    { immediate: true },
  )

  async function onClearJobFiles() {
    setClearing(true)
    try {
      // The signature the user agreed to — the api refuses if the file on disk
      // has become something else since (a Runner claiming it mid-confirm).
      const removed = await clearExporterJobFiles(confirmSig)
      toast.success(
        removed.length > 0
          ? `Removed ${removed.join(' and ')}`
          : 'Nothing to remove — the job file was already gone',
      )
      setConfirmSig('')
      await loadJobFiles()
    } catch (e) {
      if (e instanceof ExporterJobFilesChangedError) {
        // Not a failure — the answer changed while the question was open. Show
        // the new state and make them look again rather than deleting a batch
        // that may now be running.
        toast.warning('The job file changed while you were looking at it — check it again.')
      } else {
        // A locked/read-only file is a real failure: say so rather than leaving
        // the user believing the blockage is cleared — and re-read, because one
        // of the two files may well have gone before the other refused.
        toast.error(`Couldn't delete the job file: ${e instanceof Error ? e.message : String(e)}`)
      }
      setConfirmSig('')
      await loadJobFiles()
    } finally {
      setClearing(false)
    }
  }

  async function onCleanupNow() {
    setCleanupBusy(true)
    try {
      const result = await housekeepingSweep()
      const failed = result.filesFailed ?? 0
      setLastFailed(failed)
      // Stale files the sweep could NOT delete (locked/read-only) get their own
      // warning — without it, every delete failing still read as the cheerful
      // "Nothing to clean up".
      if (failed > 0) {
        toast.warning(
          result.filesDeleted > 0
            ? `Freed ${formatBytes(result.bytesFreed)} — removed ${result.filesDeleted} stale file(s), but ${failed} couldn't be deleted (locked or read-only)`
            : `Nothing was cleaned up — ${failed} stale file(s) couldn't be deleted (locked or read-only)`,
        )
      } else {
        toast.success(
          result.filesDeleted > 0
            ? `Freed ${formatBytes(result.bytesFreed)} — removed ${result.filesDeleted} stale file(s)`
            : 'Nothing to clean up — no stale scans or unused note media',
        )
      }
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
      {lastFailed > 0 && (
        <p className="text-sm text-muted-foreground">
          {lastFailed} file{lastFailed === 1 ? '' : 's'} couldn&apos;t be removed (locked?) —
          they&apos;ll be retried next sweep.
        </p>
      )}

      <div className="space-y-3 border-t pt-4">
        <div>
          <h3 className="flex w-fit items-center gap-1 text-sm font-semibold">
            DTH Exporter job file
            <InfoPopup label="DTH Exporter job file — more information">
              DTH Export and every scan hand Daz Studio their work through ONE file in your
              Daz library&apos;s{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                Scripts/DTH-Character-Studio
              </code>{' '}
              folder. The studio writes{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">dth_exporter_jobs.json</code>;
              the Runner plugin renames it to{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                running_dth_exporter_jobs.json
              </code>{' '}
              when it starts working through it, and the studio deletes that when the batch
              finishes. A batch that never started — Daz was closed mid-handoff, or the Runner
              never picked it up — leaves the file behind, and every later export and scan then
              refuses with <em>&ldquo;a batch is waiting for Daz Studio&rdquo;</em>. This clears
              it. Nothing is undone in Daz: the file is a to-do list, not a result.
            </InfoPopup>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Clear a batch handoff that got stuck and now blocks every export and scan.
          </p>
        </div>

        {jobFilesError && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <span>Couldn&apos;t read the job file: {jobFilesError}</span>
            <Button
              variant="outline"
              size="xs"
              className="shrink-0"
              onClick={() => void loadJobFiles()}
            >
              Retry
            </Button>
          </div>
        )}

        {!jobFilesError && jobFiles.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No job file — nothing is waiting for Daz Studio.
          </p>
        )}

        {jobFiles.length > 0 && (
          <>
            <ul className="space-y-1 text-sm">
              {jobFiles.map((file) => (
                <li key={file.path}>
                  <span className="font-mono">{file.fileName}</span>
                  <span className="text-muted-foreground"> — {jobFileSummary(file)}</span>
                </li>
              ))}
            </ul>
            {jobFiles.some((file) => file.mayBeLive) && (
              <p className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-500">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Daz Studio may be working through this batch right now — deleting it strands
                  that run (it keeps going in Daz, but nothing will ever report how it ended).
                  Check whether Daz is running before you clear it.
                </span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {confirmSig ? (
                <>
                  <span className="text-sm font-medium text-destructive">
                    Delete {jobFiles.length === 1 ? 'this file' : `these ${jobFiles.length} files`}?
                  </span>
                  <Button
                    variant="destructive"
                    onClick={() => void onClearJobFiles()}
                    disabled={clearing}
                  >
                    {clearing ? 'Deleting…' : 'Yes, delete'}
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmSig('')} disabled={clearing}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="destructive" onClick={() => void onAskClear()}>
                  <Trash2 /> Delete job file
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
