import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { FileText, FolderOpen } from 'lucide-react'

import { Button } from '@dth/ui'
import { listScanFrameCsvs } from '#/lib/rom/api.ts'

import type { ScanFrameCsv } from '#/lib/rom/api.ts'

/** "just now", "14 min ago", "3 h ago", else a local date — compact and scannable. */
function relativeTime(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`
  return new Date(ms).toLocaleDateString()
}

/**
 * Picks the CSV to import into a section: lists the scans `Scan_Frames.dsa`
 * wrote into the studio's scan folder (one per Daz scene, newest first), plus a
 * Browse fallback for hand-curated files. Portaled to <body> like the other
 * dialogs; Esc / backdrop cancel.
 */
export function ScanCsvPickerDialog({
  sectionLabel,
  onPick,
  onBrowse,
  onClose,
}: {
  sectionLabel: string
  onPick: (path: string) => void
  onBrowse: () => void
  onClose: () => void
}) {
  // null = still loading (avoids flashing the empty-state hint).
  const [scans, setScans] = useState<Array<ScanFrameCsv> | null>(null)
  useEffect(() => {
    let active = true
    listScanFrameCsvs()
      .then((list) => active && setScans(list))
      .catch(() => active && setScans([]))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold">Import into {sectionLabel}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Scans made with <strong>Scan_Frames</strong> in Daz Studio, one per scene — pick the
            one to import, or browse to your own CSV.
          </p>
        </div>
        {scans !== null && scans.length === 0 && (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
            No scans yet. In Daz Studio, select your character's root node and run{' '}
            <code>Scripts › DTH-Character-Studio › Scan_Frames</code> — the scan appears here
            automatically.
          </p>
        )}
        {scans !== null && scans.length > 0 && (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {scans.map((scan) => (
              <li key={scan.path}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  title={scan.path}
                  onClick={() => onPick(scan.path)}
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">{scan.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(scan.modifiedAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between gap-2">
          <Button variant="outline" onClick={onBrowse}>
            <FolderOpen /> Browse…
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
