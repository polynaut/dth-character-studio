import { useEffect, useState } from 'react'

import { ChevronDown, ChevronRight, FileText, FolderOpen, Loader2 } from 'lucide-react'

import { Button, Modal } from '@dth/ui'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { PathCode } from '#/components/path-code.tsx'
import {
  abortSceneScan,
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

/** How often the waiting run is looked at. Also the tick the "taking a while"
 *  hint counts in — one timer, two jobs. */
const POLL_MS = 1000

/** When to stop saying "this takes a moment" and name what is usually wrong.
 *  Comfortably past a cold Daz launch on a slow machine, so a working setup
 *  never sees it. */
const SLOW_SCAN_MS = 120_000

/**
 * Imports frames into a section, two ways: **scan a Daz scene** — the studio
 * opens the `.duf` through the job runner, runs `Scan_Frames` in it silently and
 * polls for the CSV — or re-use one of the scans already in the studio's scan
 * folder (one per scene, newest first), with a Browse fallback for a
 * hand-curated CSV. Dialog semantics (focus trap/restore, Esc / backdrop
 * dismissal) come from the kit's Modal.
 *
 * Dismissing it mid-scan takes the handoff back ({@link abortSceneScan}) — an
 * abandoned job file would block every export and scan that came after it.
 */
export function ScanCsvPickerDialog({
  sectionLabel,
  character,
  initialScenePath,
  onPick,
  onBrowse,
  onClose,
}: {
  sectionLabel: string
  /** Validated against the picked scene — a scan of another generation imports
   *  morph names belonging to another skeleton. */
  character: Pick<Character, 'genesis' | 'gender'>
  /** A scene dropped on the section's own Import button: the dialog opens with
   *  it already picked and checked, so the drop lands where the user aimed
   *  instead of opening an empty dialog they have to pick in again. */
  initialScenePath?: string
  onPick: (path: string) => void
  onBrowse: () => void
  onClose: () => void
}) {
  // --- the scan route: pick a .duf, check it, run Scan_Frames headless -------
  const [scenePath, setScenePath] = useState('')
  const [sceneScan, setSceneScan] = useState<SceneWearables | null>(null)
  const [checking, setChecking] = useState(false)
  const [force, setForce] = useState(false)
  /** null = not started; otherwise the run this dialog is waiting on. */
  const [run, setRun] = useState<{
    resultPath: string
    startedAtMs: number
    dazWasRunning: boolean
  } | null>(null)
  /** Ticks while a run is out, so the wait can say more the longer it lasts. */
  const [waitedMs, setWaitedMs] = useState(0)
  const [scanError, setScanError] = useState('')
  const rows = sceneScanRows(sceneScan, character)
  const blocked = sceneCompatFailed(rows) && !force

  /** Take a scene from EITHER route — the picker or a drop — and re-run the
   *  checks on it. Shared so a dropped scene is never the one that skipped
   *  validation. */
  async function applyScene(picked: string) {
    setScenePath(picked)
    setScanError('')
    setForce(false)
    setSceneScan(null)
    setChecking(true)
    const scan = await sceneWearables({ data: { scenePath: picked } }).catch(() => null)
    setSceneScan(scan)
    setChecking(false)
  }

  async function onPickScene() {
    const picked = await pickDufPath('Select the Daz scene to scan', browseStart(scenePath))
    if (picked) await applyScene(picked)
  }

  // A scene dropped on the Import button opens the dialog already pointed at it.
  // Mount only: re-running on every render would fight the user's own re-pick.
  useEffect(() => {
    if (initialScenePath) void applyScene(initialScenePath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** `startSceneScan` already took the handoff back when a live Daz never
   *  claimed it (it throws instead) — this covers the OTHER exit: a Daz the
   *  studio launched itself that never came up, and the user giving up. Without
   *  it a closed dialog would leave the global job file pending, and every later
   *  export or scan would refuse with "a batch is waiting for Daz Studio". */
  async function cancelScan() {
    if (!run) return
    setRun(null)
    setWaitedMs(0)
    await abortSceneScan().catch(() => {})
  }

  async function onStartScan() {
    setScanError('')
    setWaitedMs(0)
    try {
      const started = await startSceneScan({
        data: { scenePath, genesis: character.genesis },
      })
      setRun(started)
    } catch (error) {
      setScanError(error instanceof Error ? error.message : String(error))
    }
  }

  // Poll while a scan is out at Daz. The result file is the only thing that can
  // tell "still running" from "ran and found nothing" — see fetchSceneScanProgress.
  useEffect(() => {
    if (!run) return
    let active = true
    const timer = setInterval(() => {
      setWaitedMs((ms) => ms + POLL_MS)
      void fetchSceneScanProgress({
        data: { resultPath: run.resultPath, startedAtMs: run.startedAtMs },
      }).then((progress) => {
        if (!active) return
        if (progress.state === 'done') {
          setRun(null)
          onPick(progress.csvPath)
        } else if (progress.state === 'failed') {
          setRun(null)
          setScanError(progress.error)
        }
      })
    }, POLL_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])
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

  /** Dismissing mid-scan must not leave the handoff behind — see cancelScan. */
  function dismiss() {
    void cancelScan()
    onClose()
  }

  return (
    <Modal open onClose={dismiss} title={`Import into ${sectionLabel}`}>
      {/* The scan route: hand the studio a scene and it produces the CSV. The
          list below stays, because one scan feeds SEVERAL ROM sections — the
          second import of the same scene should not re-run Daz. */}
      <section className="rounded-lg border p-3">
        <p className="mb-2 text-sm font-medium">Scan a Daz scene</p>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {/* Same action as the picker: drag a `.duf` out of Explorer straight
              onto the button. Inert mid-scan, like the button itself — a drop
              cannot start a second run while one is out at Daz. */}
          <FileDropZone
            accept={['duf']}
            label="Drop a Daz scene"
            onDrop={(paths) => {
              const dropped = paths[0]
              if (dropped && !run) void applyScene(dropped)
            }}
          >
            <Button variant="outline" size="sm" disabled={!!run} onClick={() => void onPickScene()}>
              <FolderOpen /> {scenePath ? 'Pick another scene…' : 'Pick a scene…'}
            </Button>
          </FileDropZone>
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
        {run ? (
          <div className="mt-2 rounded-md border border-dashed p-2">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {run.dazWasRunning
                ? 'Daz Studio is opening the scene and scanning its frames — this takes a moment.'
                : 'Starting Daz Studio, then opening the scene and scanning its frames — this takes a moment.'}
            </p>
            {/* The run is out at a Daz nobody is watching, and it opens no
                dialog there by design — so after a while the silence needs a
                name, not more spinner. */}
            {waitedMs >= SLOW_SCAN_MS && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                Still nothing back. Daz Studio runs this scan with no dialogs, so it looks
                idle either way — but if it never opened the scene, the <strong>Runner
                plugin</strong> is most likely not installed (Settings → the same one DTH
                Export needs). Cancel takes the job back.
              </p>
            )}
            <div className="mt-2 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => void cancelScan()}>
                Cancel scan
              </Button>
            </div>
          </div>
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
          No scans yet — pick a scene above and the studio makes the first one. (Running{' '}
          <code>Scripts › DTH-Character-Studio › Scan_Frames</code> by hand in Daz Studio still
          works, and lands here too.)
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
        <Button variant="ghost" onClick={dismiss}>
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
