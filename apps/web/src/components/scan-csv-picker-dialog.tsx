import { useEffect, useState } from 'react'

import { ChevronDown, ChevronRight, FileText, FolderOpen, Loader2 } from 'lucide-react'

import { Button, Modal } from '@dth/ui'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { PathCode } from '#/components/path-code.tsx'
import {
  fetchSceneScanProgress,
  listScanFrameCsvs,
  sceneWearables,
  startSceneScan,
} from '#/lib/rom/api.ts'
import { SceneValidationTable } from '#/components/scene-compat.tsx'
import { sceneCompatFailed, sceneScanRows } from '#/lib/scene-compat.ts'
import { pickDufPath } from '#/lib/desktop.ts'
import { browseStart } from '#/lib/path.ts'

import type { ScanFrameCsv, SceneWearables } from '#/lib/rom/api.ts'
import type { Character } from '@dth/rom'

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
  character,
  onPick,
  onBrowse,
  onClose,
}: {
  sectionLabel: string
  /** Validated against the picked scene — a scan of another generation imports
   *  morph names belonging to another skeleton. */
  character: Pick<Character, 'genesis' | 'gender'>
  onPick: (path: string) => void
  onBrowse: () => void
  onClose: () => void
}) {
  // --- the scan route: pick a .duf, check it, run Scan_Frames headless -------
  const [scenePath, setScenePath] = useState('')
  const [sceneScan, setSceneScan] = useState<SceneWearables | null>(null)
  const [checking, setChecking] = useState(false)
  const [force, setForce] = useState(false)
  /** '' = not started; otherwise the result file this run is waiting on. */
  const [resultPath, setResultPath] = useState('')
  const [scanError, setScanError] = useState('')
  const rows = sceneScanRows(sceneScan, character)
  const blocked = sceneCompatFailed(rows) && !force

  async function onPickScene() {
    const picked = await pickDufPath('Select the Daz scene to scan', browseStart(scenePath))
    if (!picked) return
    setScenePath(picked)
    setScanError('')
    setForce(false)
    setSceneScan(null)
    setChecking(true)
    const scan = await sceneWearables({ data: { scenePath: picked } }).catch(() => null)
    setSceneScan(scan)
    setChecking(false)
  }

  async function onStartScan() {
    setScanError('')
    try {
      const started = await startSceneScan({
        data: { scenePath, genesis: character.genesis },
      })
      setResultPath(started.resultPath)
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error))
    }
  }

  // Poll while a scan is out at Daz. The result file is the only thing that can
  // tell "still running" from "ran and found nothing" — see fetchSceneScanProgress.
  useEffect(() => {
    if (!resultPath) return
    let active = true
    const timer = setInterval(() => {
      void fetchSceneScanProgress({ data: { resultPath } }).then((progress) => {
        if (!active) return
        if (progress.state === 'done') {
          setResultPath('')
          onPick(progress.csvPath)
        } else if (progress.state === 'failed') {
          setResultPath('')
          setScanError(progress.error)
        }
      })
    }, 1000)
    return () => {
      active = false
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultPath])
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
      {/* The scan route: hand the studio a scene and it produces the CSV. The
          list below stays, because one scan feeds SEVERAL ROM sections — the
          second import of the same scene should not re-run Daz. */}
      <section className="rounded-lg border p-3">
        <p className="mb-2 text-sm font-medium">Scan a Daz scene</p>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={!!resultPath} onClick={() => void onPickScene()}>
            <FolderOpen /> {scenePath ? 'Pick another scene…' : 'Pick a scene…'}
          </Button>
          {scenePath && (
            <span className="min-w-0 truncate text-xs text-muted-foreground" title={scenePath}>
              {scenePath.split(/[\\/]/).pop()}
            </span>
          )}
        </div>
        {scenePath && (
          <SceneValidationTable
            rows={rows}
            loading={checking}
            force={force}
            onForceChange={setForce}
            forceLabel="Scan anyway — I know this scene is right"
          />
        )}
        {scanError && <p className="mt-2 text-sm text-destructive">{scanError}</p>}
        {resultPath ? (
          <p className="mt-2 flex items-center gap-2 rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Daz Studio is opening the scene and scanning its frames — this takes a moment.
          </p>
        ) : (
          scenePath && (
            <div className="mt-2 flex justify-end">
              <Button
                size="sm"
                disabled={checking || blocked}
                title={blocked ? 'The scene failed a check above' : undefined}
                onClick={() => void onStartScan()}
              >
                Start scan
              </Button>
            </div>
          )
        )}
      </section>

      <p className="text-sm text-muted-foreground">
        Or re-use a scan you already made — one per scene, newest first. The same scan can feed
        several ROM sections.
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
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        {/* Same action as the picker: drop a hand-curated CSV straight on it. */}
        <FileDropZone
          accept={['csv']}
          label="Drop a CSV"
          onDrop={(paths) => {
            // Identical to choosing a listed scan — the path just came from
            // Explorer instead of the list.
            const dropped = paths[0]
            if (dropped) onPick(dropped)
          }}
        >
          <Button variant="outline" onClick={onBrowse}>
            <FolderOpen /> Browse…
          </Button>
        </FileDropZone>
      </div>
    </Modal>
  )
}
