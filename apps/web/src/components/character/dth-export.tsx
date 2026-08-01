import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Ban, Loader2, Play, Wand } from 'lucide-react'
import { toast } from 'sonner'

import {
  Button,
  InfoPopup,
  Label,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  useRefetchOnFocus,
} from '@dth/ui'
import dthLogo from '#/assets/dth-logo.webp'
import { Portrait } from '#/components/portrait.tsx'
import { PrimaryBadge } from '#/components/primary-badge.tsx'
import {
  abortExporterJobs,
  dazStudioRunning,
  dismissExportRun,
  dismissHoudiniRun,
  executeCharacterJobs,
  exporterJobsPending,
  fetchExecuteScenes,
  fetchExportRunProgress,
  fetchExportRunnerGate,
  fetchHoudiniRunProgress,
  launchDazForPendingJobs,
  openScene,
  startHoudiniExport,
} from '#/lib/rom/api.ts'
import { holdBusyCursor } from '#/lib/busy-cursor.ts'
import { normalizeSceneKey } from '#/lib/rom/execute-jobs.ts'

import type { ExecuteSceneStatus, ExportRunProgress, RunnerGate } from '#/lib/rom/api.ts'
import type { HoudiniRunState } from '#/lib/rom/houdini-jobs.ts'
import type { ExportMode } from '#/lib/rom/execute-jobs.ts'
import type { Character } from '@dth/rom'

/**
 * The header's **DTH Export** button + its scene-picker dialog: choose which
 * linked Daz scenes to run through the DTH Exporter Plugin, then hand them off
 * as a job file and start Daz Studio (api/execute.ts +
 * docs/exporter-plugin-job-file.md).
 *
 * The dialog lists every linked scene as a simplified Daz scene card (accent
 * bar + selected styling like the editor's scene cards) with a checkbox; the
 * AFFECTED scenes — changed `.duf` or definition since their last handoff —
 * come pre-checked. Each row's wand solos it (check only this one). Confirm
 * needs at least one checked scene.
 *
 * Disabled while the draft is dirty (the export runs the GENERATED scripts on
 * disk, which lag unsaved edits), without an export directory (the runs exist
 * to deliver exports), or without a configured Daz library. Inside the dialog,
 * Start is additionally gated on the Runner plugin's install state (the export
 * runs THROUGH the Runner): missing or older-than-bundled blocks with a notice
 * deep-linking to Settings → General (`fetchExportRunnerGate`).
 *
 * While a job file is WAITING for Daz (written but not yet renamed — the
 * Runner renames it `running_…` when it starts, so "the un-renamed file
 * exists" is "pending") the button turns into **Abort**: clicking deletes the
 * job file (and rolls the aborted scenes' handoff stamps back). Once the
 * Runner renames it, aborting is over and the button becomes a live
 * **Exporting n%** state — the Runner owns the file's `progress` + per-job
 * statuses, the studio just polls the file (api/execute.ts). At 100% the
 * studio deletes the file and toasts the outcome (including per-scene
 * failures); a run whose Daz exited early toasts a failure instead. Clicking
 * the progress button stops watching only. Status refreshes on window focus
 * and polls lightly while pending/running.
 */
/** The DazToHue brand mark as a button icon. The button's automatic icon
 *  sizing only targets SVGs, so the img sizes itself — `size-6`, larger than
 *  the svg default; the mark's fine detail needs it. The host button keeps
 *  `px-3` by hand for the same reason (`has-[>svg]` doesn't see an img). */
function DthLogo() {
  return <img src={dthLogo} alt="" aria-hidden className="size-6 shrink-0 object-contain" />
}

export function DthExportAction({
  projectId,
  character,
  saving,
  dirty,
  dazLibraryConfigured,
}: {
  projectId: string
  character: Character
  saving: boolean
  dirty: boolean
  /** “My DAZ 3D Library” is set — where the job file and scripts live. */
  dazLibraryConfigured: boolean
}) {
  const [open, setOpen] = useState(false)
  // null = not yet checked (renders as the normal export button).
  const [pending, setPending] = useState<boolean | null>(null)
  const [progress, setProgress] = useState<Extract<ExportRunProgress, { state: 'running' }> | null>(
    null,
  )
  const [aborting, setAborting] = useState(false)
  // The Houdini half of an "Export too" run, once the Daz batch has finished
  // and handed over. Its own watch: Houdini works long after Daz is done.
  const [houdini, setHoudini] = useState<HoudiniRunState | null>(null)
  // A handoff written against a SHUTTING-DOWN Daz (running process, batch
  // never claimed) — the modal below waits out the exit and relaunches.
  const [dazClosing, setDazClosing] = useState(false)

  // The one status refresh: is a job file still waiting (→ Abort), and how far
  // is the in-memory export watch (→ Exporting n/m)? Runs on mount + window
  // focus (tabbing back from Daz) and polls while either state is live.
  async function refreshStatus() {
    const [isPending, run] = await Promise.all([exporterJobsPending(), fetchExportRunProgress()])
    setPending(isPending)
    // '' = a batch adopted for display only (a scene-card ROM generate, or a
    // run this window didn't start): the Runner is busy either way, so every
    // editor's button shows the live progress — outcomes stay owner-only.
    if (!run || (run.characterId !== '' && run.characterId !== character.id)) {
      setProgress(null)
      return
    }
    if (run.state === 'finished') {
      // The studio deleted the finished job file — report the outcome.
      setProgress(null)
      const scenes = `${run.total} scene${run.total === 1 ? '' : 's'}`
      if (run.failed > 0) {
        toast.warning(`DTH Export finished — ${run.failed} of ${scenes} failed.`, {
          description: run.errors.length ? run.errors.join('\n') : undefined,
        })
      } else {
        toast.success(`DTH Export finished — ${scenes} exported.`)
      }
      // The dialog's after-export pick: open the Houdini project the fresh
      // exports belong to — unless EVERY scene failed (nothing new to look at).
      if (run.openHoudiniProject && run.failed < run.total) {
        if (run.houdiniExport) {
          // "Export too": the project opens with the job in its environment and
          // exports itself. Only the scenes this batch ran are in scope.
          toast.info('Opening the Houdini project to export…')
          void startHoudiniExport({
            data: {
              projectId,
              id: character.id,
              hipPath: run.openHoudiniProject,
              scenes: run.scenes,
            },
          })
            .then((started) => {
              setHoudini({ state: 'starting' })
              const count = `${started.scenes} scene${started.scenes === 1 ? '' : 's'}`
              toast.success(`Houdini is opening — ${count} handed over.`)
            })
            .catch((err: unknown) => {
              toast.error(
                `Couldn't start the Houdini export: ${err instanceof Error ? err.message : String(err)}`,
              )
            })
        } else {
          toast.info('Opening the Houdini project…')
          void openScene({ data: { scenePath: run.openHoudiniProject } }).catch((err: unknown) => {
            toast.error(
              `Couldn't open the Houdini project: ${err instanceof Error ? err.message : String(err)}`,
            )
          })
        }
      }
      return
    }
    if (run.state === 'dead') {
      setProgress(null)
      toast.error('DTH Export did not finish — Daz Studio is no longer running (or the job file disappeared).')
      return
    }
    // 'pending' renders through the Abort button (isPending); only a live
    // Runner-owned run shows the progress state.
    setProgress(run.state === 'running' ? run : null)
  }

  /** The Houdini half's own poll — armed only after an "Export too" handoff.
   *  Separate from the Daz watch because it outlives it: the batch is finished
   *  and reported by the time Houdini starts opening the project. */
  async function refreshHoudini() {
    const run = await fetchHoudiniRunProgress()
    if (!run || run.characterId !== character.id) {
      setHoudini(null)
      return
    }
    if (run.state === 'finished') {
      setHoudini(null)
      const summary = run.summary || 'nothing to export'
      if (run.failed > 0 || run.error) {
        toast.warning(`Houdini export finished — ${summary}.`, {
          description: run.error || undefined,
        })
      } else {
        toast.success(`Houdini export finished — ${summary}.`)
      }
      return
    }
    if (run.state === 'dead') {
      setHoudini(null)
      toast.error('The Houdini export did not finish — Houdini is no longer running.')
      return
    }
    setHoudini(run)
  }
  useRefetchOnFocus(
    () => {
      void refreshStatus()
    },
    [],
    { immediate: true },
  )
  const watching = pending === true || progress !== null || houdini !== null
  useEffect(() => {
    if (!watching) return
    const id = window.setInterval(() => {
      void refreshStatus()
      // Cheap while nothing is armed: fetchHoudiniRunProgress returns null
      // immediately without touching the filesystem.
      void refreshHoudini()
    }, 2500)
    return () => window.clearInterval(id)
    // Re-arm on `watching` alone (ONE interval): refreshStatus only captures
    // character.id, which is constant for a mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching])
  // While the Runner works the batch, the whole app carries the OS progress
  // cursor — "it's working" is visible wherever the mouse is.
  const running = progress !== null
  useEffect(() => {
    if (!running) return
    return holdBusyCursor()
  }, [running])

  async function onAbort() {
    setAborting(true)
    try {
      await abortExporterJobs({ data: { projectId, id: character.id } })
      setPending(false)
      toast.success('Pending export jobs aborted — the job file was deleted.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setAborting(false)
    }
  }

  if (pending === true) {
    return (
      <Button
        variant="outline-destructive"
        onClick={() => void onAbort()}
        disabled={aborting}
        title="A job file is waiting for Daz Studio — Abort deletes it, nothing will run"
      >
        <Ban /> {aborting ? 'Aborting…' : 'Abort'}
      </Button>
    )
  }

  if (progress) {
    // The Runner renamed the job file and owns its progress — the studio just
    // polls the file. Clicking stops the WATCH only (the run in Daz can't be
    // stopped from here); the next handoff cleans the leftover file up.
    return (
      <Button
        variant="outline"
        className="px-3"
        onClick={() => {
          dismissExportRun()
          setProgress(null)
        }}
        title={`Daz Studio is working the batch — ${progress.processed} of ${progress.total} scene${progress.total === 1 ? '' : 's'} processed${progress.failed > 0 ? ` (${progress.failed} failed)` : ''}. Click to stop watching.`}
      >
        {/* Processed count, not the percent — the % only moved in row-sized
            jumps anyway (the Runner's progress is rows ÷ total). */}
        <Loader2 className="animate-spin" /> Exporting {progress.processed}/{progress.total}
      </Button>
    )
  }

  if (houdini) {
    // The Daz batch is done and reported; Houdini is opening the project (or
    // already working through it). Same deal as above — clicking stops the
    // WATCH, never the export, which keeps running in the user's Houdini.
    const label =
      houdini.state === 'running' && houdini.total > 0
        ? `Houdini ${houdini.done}/${houdini.total}`
        : 'Houdini opening…'
    return (
      <Button
        variant="outline"
        className="px-3"
        onClick={() => {
          dismissHoudiniRun()
          setHoudini(null)
        }}
        title={
          houdini.state === 'running'
            ? `Houdini is exporting — ${houdini.done} of ${houdini.total} node${houdini.total === 1 ? '' : 's'} done. Click to stop watching.`
            : 'Houdini is opening the project; the export starts once the scene has loaded. Click to stop watching.'
        }
      >
        <Loader2 className="animate-spin" /> {label}
      </Button>
    )
  }

  const sceneLinked = Boolean(character.scenePath)
  const exportDirSet = character.exportPath.trim() !== ''
  const disabled = saving || dirty || !sceneLinked || !dazLibraryConfigured || !exportDirSet
  const blockedHint = !dazLibraryConfigured
    ? 'Set “My DAZ 3D Library” in Settings first'
    : !sceneLinked
      ? 'Link a primary Daz scene first'
      : !exportDirSet
        ? 'Set an export directory first — the export runs deliver into it'
        : dirty
          ? 'Save first — the export runs the generated scripts on disk'
          : undefined

  return (
    <>
      <Button
        variant="outline"
        className="px-3"
        onClick={() => setOpen(true)}
        disabled={disabled}
        // Only the blocked states carry a tooltip (they explain WHY the button
        // is off); the enabled button speaks for itself — the dialog's title
        // popup holds the long description.
        title={blockedHint}
      >
        <DthLogo /> DTH Export
      </Button>
      {open && (
        <DthExportDialog
          projectId={projectId}
          character={character}
          onClose={() => setOpen(false)}
          onExported={() => {
            setPending(true)
            // Arm the progress view right away (0/n until Daz delivers).
            void refreshStatus()
          }}
          onDazClosing={() => setDazClosing(true)}
        />
      )}
      {dazClosing && (
        <WaitForDazCloseModal
          onDone={(started) => {
            setDazClosing(false)
            if (started) toast.success('Daz Studio started — the export begins now.')
            void refreshStatus()
          }}
          onCancel={() => setDazClosing(false)}
        />
      )}
    </>
  )
}

/**
 * The handoff was written while Daz Studio was still SHUTTING DOWN (the
 * process lingers after close, its Runner never claims the batch, and a fresh
 * launch would die against the dying single instance). This modal watches the
 * process and, the moment it is really gone, starts Daz itself — the pending
 * job file is then picked up on launch. Closing the modal only stops the
 * watch: the batch stays queued (the header button still aborts it), and it
 * vanishes on its own when the batch gets claimed after all or is aborted.
 */
function WaitForDazCloseModal({
  onDone,
  onCancel,
}: {
  /** The wait resolved: `started` = Daz was launched (or runs again) for the
   *  pending batch; false = the handoff disappeared (aborted / claimed late). */
  onDone: (started: boolean) => void
  onCancel: () => void
}) {
  useEffect(() => {
    let active = true
    let settled = false
    const id = window.setInterval(() => {
      void (async () => {
        const pendingExists = await exporterJobsPending()
        if (!active || settled) return
        if (!pendingExists) {
          settled = true
          onDone(false)
          return
        }
        const running = await dazStudioRunning()
        if (!active || settled || running) return
        settled = true
        onDone(await launchDazForPendingJobs())
      })()
    }, 1000)
    return () => {
      active = false
      window.clearInterval(id)
    }
    // Mount-only: the callbacks are stable enough for this modal's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Modal open onClose={onCancel} title="Waiting for Daz Studio to close…" dismissible>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin" />
        <span>
          Daz Studio didn&apos;t pick the export up — it&apos;s probably still closing. As soon
          as the process is gone, Daz Studio starts again by itself and runs the export.
          Closing this keeps the batch queued (the header button aborts it).
        </span>
      </p>
    </Modal>
  )
}

/** One selectable scene row — a simplified Daz scene card: checkbox, `.tip.png`
 *  portrait, name, status hint, and the solo wand. Clicking the row toggles its
 *  checkbox, double-clicking selects EVERY row (the wand's counterpart); the
 *  daz-card utility supplies the tint/ring via `data-selected`. */
function SceneRow({
  status,
  mode,
  checked,
  loading,
  onToggle,
  onSolo,
  onSelectAll,
}: {
  status: ExecuteSceneStatus
  /** The chosen run — decides what the row's hint reports and whether it can
   *  run at all (Export only needs a saved ROM animation). */
  mode: ExportMode
  checked: boolean
  /** Affected-detection still running — checkboxes are settling, keep quiet. */
  loading: boolean
  onToggle: () => void
  onSolo: () => void
  onSelectAll: () => void
}) {
  const fileName = status.scenePath.split(/[\\/]/).pop() ?? status.scenePath
  const displayName = fileName.replace(/\.[^./\\]+$/, '')
  // Export only runs off the SAVED ROM animation, so a scene without one has
  // nothing to export — disabled, like a missing scene file.
  const noRom = mode === 'export-only' && !loading && !status.romExists
  const disabled = status.missing || noRom
  // Each mode reports the state that decides ITS pre-selection.
  const highlight = mode === 'export-only' ? status.romUnexported : status.affected
  const hint = status.missing
    ? 'Scene file missing — relink it in the editor'
    : loading
      ? 'Checking for changes…'
      : noRom
        ? 'No ROM animation yet — run a ROM build for this scene first'
        : mode === 'export-only'
          ? status.romUnexported
            ? 'ROM animation changed since its last export'
            : 'ROM animation already exported as it stands'
          : status.affected
            ? 'Changed since the last export'
            : 'Unchanged since the last export'
  return (
    <div className="group/card relative w-full">
      <div
        className={`daz-card relative flex items-center gap-3 rounded-lg border p-3 pl-4${disabled ? ' opacity-50' : ''}`}
        data-selected={checked ? 'true' : undefined}
      >
        {/* z-10 lifts the real controls above the row's cover button. */}
        <input
          type="checkbox"
          className="relative z-10 size-4 shrink-0 accent-daz-green"
          aria-label={`Export ${displayName}`}
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
        />
        <Portrait
          scenePath={status.scenePath}
          name={displayName}
          className="aspect-[3/4] h-[56px] shrink-0 rounded-md"
          fallbackClassName="text-lg"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-medium">{displayName}</span>
            {status.primary && <PrimaryBadge dense />}
          </div>
          <p
            className={`mt-0.5 text-xs ${
              status.missing
                ? 'text-destructive'
                : noRom
                  ? 'text-amber-500'
                  : highlight && !loading
                    ? 'text-daz-green'
                    : 'text-muted-foreground'
            }`}
          >
            {hint}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative z-10 shrink-0 border border-transparent hover:border-white/20 hover:bg-[#333] hover:shadow-sm dark:hover:bg-[#333]"
          title="Export only this scene"
          aria-label={`Export only ${displayName}`}
          disabled={disabled}
          onClick={onSolo}
        >
          <Wand className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
      {/* Row-wide toggle as a transparent cover (the LinkedAssetCard pattern) —
          checkbox and wand sit above it with z-10. A DOUBLE click selects all
          rows: the two single-click toggles fire first and cancel out, then
          dblclick lands, so the end state is deterministic. */}
      {!disabled && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onToggle}
          onDoubleClick={onSelectAll}
          className="absolute inset-0 rounded-lg"
        />
      )}
      {/* Left accent bar, over the cover button like the scene cards. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-daz-green" />
    </div>
  )
}

/** What each run does, in the user's words — the dialog's first step. Order is
 *  the offer order; `rom-export` leads because it is the default full run. */
const MODE_CHOICES: ReadonlyArray<{ mode: ExportMode; title: string; blurb: string }> = [
  {
    mode: 'rom-export',
    title: 'ROM + Export',
    blurb:
      'Build a fresh ROM, save the ROM animation scene, then export everything — skeletal mesh and hair.',
  },
  {
    mode: 'rom-only',
    title: 'ROM only',
    blurb:
      'Build the ROM and save the ROM animation scene, skipping the export. Needs no export directory.',
  },
  {
    mode: 'export-only',
    title: 'Export only',
    blurb:
      'Export the saved ROM animations as they stand — hair included — without rebuilding. For ROMs you edited by hand in Daz.',
  },
]

/** Step 1: what the run should do. Picking a card advances to the scenes. */
function ModeStep({ onPick }: { onPick: (mode: ExportMode) => void }) {
  return (
    <div className="space-y-2">
      {MODE_CHOICES.map((choice) => (
        <button
          key={choice.mode}
          type="button"
          onClick={() => onPick(choice.mode)}
          className="daz-card block w-full rounded-lg border p-3 text-left transition-colors hover:border-daz-green/60"
        >
          <span className="block text-base font-medium">{choice.title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{choice.blurb}</span>
        </button>
      ))}
    </div>
  )
}

/** The dialog's Runner-plugin notice: the export runs through the Runner in
 *  Daz Studio, so a missing or outdated install blocks Start — this box says
 *  why and deep-links to Settings → General (where the Runner section lives). */
function RunnerGateNotice({ gate }: { gate: Extract<RunnerGate, { blocked: true }> }) {
  return (
    <div className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
      <p>
        {gate.reason === 'no-install-folder'
          ? 'Exports run through the Runner plugin in Daz Studio, but no Daz Studio install folder is configured yet.'
          : gate.reason === 'not-installed'
            ? 'Exports run through the Runner plugin, which is not installed in this Daz Studio yet.'
            : `A Runner plugin update is pending — Daz Studio has ${gate.installedVersion || 'an unknown version'} installed, this app bundles ${gate.bundledVersion || 'a newer one'}.`}
      </p>
      <p>
        <Link
          to="/settings"
          search={{ tab: 'general' }}
          className="font-medium text-primary underline underline-offset-2"
        >
          {gate.reason === 'update-pending' ? 'Update it in Settings' : 'Set it up in Settings'}
        </Link>{' '}
        first, then come back to export.
      </p>
    </div>
  )
}

function DthExportDialog({
  projectId,
  character,
  onClose,
  onExported,
  onDazClosing,
}: {
  projectId: string
  character: Character
  onClose: () => void
  /** A handoff was written — the header button flips to Abort. */
  onExported: () => void
  /** The handoff went to a Daz that is still shutting down — the caller shows
   *  the wait-and-relaunch modal (see WaitForDazCloseModal). */
  onDazClosing: () => void
}) {
  // Rows render immediately from the linked scenes; the affected-detection
  // (one stat + signature per scene) fills in and pre-checks the changed ones.
  const [status, setStatus] = useState<Array<ExecuteSceneStatus> | null>(null)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  // Step 1 picks WHAT the run does; null = still on that step. The ref lets the
  // scene probe (kicked off at mount, in parallel with step 1) seed the right
  // pre-selection whenever it lands — before or after the pick.
  const [mode, setMode] = useState<ExportMode | null>(null)
  const modeRef = useRef<ExportMode | null>(null)
  // The optional after-export pick ('' = open nothing) — one of the
  // character's linked Houdini projects, opened when the batch FINISHES.
  const [openHoudini, setOpenHoudini] = useState('')
  const [houdiniExport, setHoudiniExport] = useState(false)
  // null = still checking (Start stays off for the moment the probe takes).
  const [runner, setRunner] = useState<RunnerGate | null>(null)

  useEffect(() => {
    let active = true
    // A failed probe must not brick exporting — only a definite missing/
    // outdated verdict blocks (the gate itself already treats unreadable
    // runner states as unblocked).
    fetchExportRunnerGate()
      .then((gate) => {
        if (active) setRunner(gate)
      })
      .catch(() => {
        if (active) setRunner({ blocked: false })
      })
    return () => {
      active = false
    }
  }, [])

  const linked = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const rows: Array<ExecuteSceneStatus> =
    status ??
    linked.map((scenePath, index) => ({
      scenePath,
      primary: index === 0,
      affected: false,
      missing: false,
      romExists: false,
      romUnexported: false,
    }))

  /** Which scenes a mode pre-checks: the ones whose work is outstanding for
   *  THAT run — changed inputs for a ROM build, an unexported saved ROM for
   *  the export-only pass (which can only run where a ROM animation exists). */
  const preChecked = (scenes: Array<ExecuteSceneStatus>, forMode: ExportMode): Set<string> =>
    new Set(
      scenes
        .filter((s) =>
          forMode === 'export-only' ? s.romExists && s.romUnexported : s.affected && !s.missing,
        )
        .map((s) => s.scenePath),
    )

  useEffect(() => {
    let active = true
    fetchExecuteScenes({ data: { projectId, id: character.id } })
      .then((scenes) => {
        if (!active) return
        setStatus(scenes)
        // The mode may already be picked (the probe outlives step 1) — seed the
        // checks for whichever run is chosen, defaulting to the full one.
        setChecked(preChecked(scenes, modeRef.current ?? 'rom-export'))
      })
      .catch((error: unknown) => {
        if (!active) return
        // Detection failing must not block a manual choice — the rows settle
        // unchecked (no scene reads as "changed") and the export stays possible.
        setStatus(
          [character.scenePath, ...character.extraScenes]
            .filter(Boolean)
            .map((scenePath, index) => ({
              scenePath,
              primary: index === 0,
              affected: false,
              missing: false,
              // Unknown, not "absent": leaving rows selectable keeps a manual
              // export-only pick possible when the probe failed.
              romExists: true,
              romUnexported: false,
            })),
        )
        toast.error(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
    }
    // Mount-only ON PURPOSE (the dialog is modal — the scene list can't change
    // while it's open): re-running on a draft-identity change (the focus-driven
    // avatar sync patches the draft when tabbing back from Daz) would refetch
    // and wipe the user's checkbox choices mid-pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, character.id])

  function toggle(scene: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(scene)) next.delete(scene)
      else next.add(scene)
      return next
    })
  }

  /** Step 1 → step 2: the pick decides which scenes start checked (each mode
   *  has its own "outstanding work" rule), so re-picking re-seeds them. */
  function pickMode(next: ExportMode) {
    modeRef.current = next
    setMode(next)
    if (status) setChecked(preChecked(status, next))
  }

  // Back to step 1 clears the pick so a re-pick re-seeds the checks.
  function backToModes() {
    modeRef.current = null
    setMode(null)
  }

  async function onExport() {
    setBusy(true)
    try {
      const result = await executeCharacterJobs({
        // Preserve row order — the jobs run top to bottom.
        data: {
          projectId,
          id: character.id,
          scenes: rows.filter((r) => checked.has(r.scenePath)).map((r) => r.scenePath),
          mode: mode ?? 'rom-export',
          openHoudiniProject: openHoudini || undefined,
          houdiniExport: openHoudini !== '' && houdiniExport,
        },
      })
      onExported()
      onClose()
      if (result.dazClosing) {
        // No toast — the wait modal explains what happens next.
        onDazClosing()
        return
      }
      const count = `${result.scenes.length} scene${result.scenes.length === 1 ? '' : 's'}`
      const what = mode === 'rom-only' ? 'queued for a ROM build' : 'queued for export'
      toast.success(
        result.dazWasRunning
          ? // The plugin polls for the job file, so a running Daz picks it up.
            `Jobs handed to the running Daz Studio — ${count} ${what}.`
          : `Started Daz Studio — ${count} ${what}.`,
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-1.5">
          {mode ? `DTH Export — ${MODE_CHOICES.find((c) => c.mode === mode)?.title}` : 'DTH Export'}
          <InfoPopup label="DTH Export — more information">
            Choose what the run does, then the Daz scenes it runs on. Scenes with outstanding
            work are pre-selected; the wand picks a single scene, a double-click selects all.
          </InfoPopup>
        </span>
      }
      dismissible={!busy}
    >
      {mode === null ? (
        <ModeStep onPick={pickMode} />
      ) : (
        <>
      <p className="text-xs text-muted-foreground">
        {mode === 'export-only'
          ? 'Exports each selected scene’s saved ROM animation as it stands — no rebuild, so this is the quick one.'
          : 'Heads up: this takes a long time — Daz Studio plays through the full ROM for every selected scene.'}
      </p>
      <div className="space-y-2">
        {rows.map((row) => (
          <SceneRow
            key={normalizeSceneKey(row.scenePath)}
            status={row}
            mode={mode}
            checked={checked.has(row.scenePath)}
            loading={status === null}
            onToggle={() => toggle(row.scenePath)}
            onSolo={() => setChecked(new Set([row.scenePath]))}
            onSelectAll={() =>
              setChecked(
                new Set(
                  rows
                    .filter((r) => !r.missing && (mode !== 'export-only' || r.romExists))
                    .map((r) => r.scenePath),
                ),
              )
            }
          />
        ))}
      </div>
      {mode !== 'rom-only' && character.houdiniProjects.length > 0 && (
        <div>
          <Label className="mb-1">Open Houdini project after export</Label>
          <Select
            value={openHoudini || 'none'}
            onValueChange={(value) => setOpenHoudini(value === 'none' ? '' : value)}
          >
            <SelectTrigger className="w-72">
              {/* Radix Select forbids a ""-valued item — 'none' is the sentinel. */}
              <SelectValue placeholder="Don't open" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Don&apos;t open</SelectItem>
              {character.houdiniProjects.map((hip) => (
                <SelectItem key={hip} value={hip}>
                  {(hip.split(/[\\/]/).pop() ?? hip).replace(/\.[^./\\]+$/, '')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Only offered once a project is picked — the toggle has nothing to
              run in otherwise. Off by default: it drives the user's own Houdini,
              which is not something to opt them into silently. */}
          {openHoudini !== '' && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm">
              <Switch
                checked={houdiniExport}
                onCheckedChange={setHoudiniExport}
                className="mt-0.5"
                aria-label="Export too"
              />
              <span>
                Export too
                <span className="block text-xs text-muted-foreground">
                  Run the project&apos;s DazToHue exports for the selected scenes once it opens.
                </span>
              </span>
            </label>
          )}
        </div>
      )}
      {runner?.blocked && <RunnerGateNotice gate={runner} />}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="ghost" disabled={busy} onClick={backToModes}>
          Back
        </Button>
        <Button
          disabled={busy || checked.size === 0 || !runner || runner.blocked}
          title={
            runner?.blocked
              ? 'The Runner plugin needs attention in Settings first'
              : checked.size === 0
                ? 'Select at least one scene'
                : undefined
          }
          onClick={() => void onExport()}
        >
          <Play /> {busy ? 'Starting…' : 'Start'}
        </Button>
      </div>
        </>
      )}
    </Modal>
  )
}
