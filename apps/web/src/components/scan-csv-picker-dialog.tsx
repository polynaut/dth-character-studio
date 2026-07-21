import { useEffect, useState } from 'react'

import { ChevronDown, ChevronRight, FileText, FolderOpen } from 'lucide-react'

import { Button, Modal } from '@dth/ui'
import { PathCode } from '#/components/path-code.tsx'
import { listScanFrameCsvs } from '#/lib/rom/api.ts'

import type { ScanFrameCsv } from '#/lib/rom/api.ts'

/** "just now", "14 min ago", "3 h ago", else a local date — compact and scannable. */
function relativeTime(ms: number): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`
  return new Date(ms).toLocaleDateString(navigator.language)
}

/** Middle-truncate a path to its first and last segments, so the chip shows
 *  where it starts and which file it is. Copying still yields the full path. */
function truncatePath(p: string): string {
  const parts = p.split('/')
  return parts.length <= 5 ? p : [...parts.slice(0, 2), '…', ...parts.slice(-2)].join('/')
}

/**
 * Picks the CSV to import into a section: lists the scans `Scan_Frames.dsa`
 * wrote into the studio's scan folder (one per Daz scene, newest first), plus a
 * Browse fallback for hand-curated files. Dialog semantics (focus trap/restore,
 * Esc / backdrop dismissal) come from the kit's Modal.
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
  // The scan whose file-path chip is expanded below its row (one at a time).
  const [expandedPath, setExpandedPath] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    listScanFrameCsvs()
      .then((list) => active && setScans(list))
      .catch(() => active && setScans([]))
    return () => {
      active = false
    }
  }, [])

  return (
    <Modal open onClose={onClose} title={`Import into ${sectionLabel}`}>
      <p className="text-sm text-muted-foreground">
        Scans made with <strong>Scan_Frames</strong> in Daz Studio, one per scene — pick the
        one to import, or browse to your own CSV.
      </p>
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
            <li key={scan.path} className="rounded-md border">
              <div className="flex items-center">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  onClick={() => onPick(scan.path)}
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">{scan.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {relativeTime(scan.modifiedAt)}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="Show the scan's file path"
                  className="mr-1 shrink-0 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={() =>
                    setExpandedPath(expandedPath === scan.path ? null : scan.path)
                  }
                >
                  {expandedPath === scan.path ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                </button>
              </div>
              {expandedPath === scan.path && (
                <div className="border-t px-3 py-2 text-xs">
                  {/* Click copies the FULL path, Alt+click reveals it — the chip
                      only displays a start…end truncation. */}
                  <PathCode path={scan.path}>{truncatePath(scan.path)}</PathCode>
                </div>
              )}
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
    </Modal>
  )
}
