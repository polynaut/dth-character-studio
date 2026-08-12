import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
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
  useModifierHeld,
  useRefetchOnFocus,
} from '@dth/ui'
import dazLogo from '#/assets/daz-logo.png'
import dthLogo from '#/assets/dth-logo.webp'
import houdiniLogo from '#/assets/houdini-logo.svg'
import { Portrait } from '#/components/portrait.tsx'
import { PrimaryBadge } from '#/components/primary-badge.tsx'
import { RunnerGateNotice } from '#/components/runner-gate-notice.tsx'
import {
  abortExporterJobs,
  clearExporterJobFiles,
  dismissExportRun,
  executeCharacterJobs,
  exportDazStudioRunning,
  exporterJobsPending,
  exporterJobsWorking,
  fetchExecuteScenes,
  fetchExportRunProgress,
  fetchCachedHoudiniScans,
  fetchExportRunnerGate,
  fetchHoudiniRunProgress,
  fileExists,
  launchDazForPendingJobs,
  openScene,
  startHoudiniExport,
} from '#/lib/rom/api.ts'
import { holdBusyCursor } from '#/lib/busy-cursor.ts'
import {
  formatClock,
  formatElapsed,
  hipSelectionAfterToggle,
  hipsForSelectedScenes,
  stampLogLines,
  houdiniModeForSelection,
  normalizeSceneKey,
  preCheckedScenes,
  scenesMissingExport,
  scenesMissingRomAnimation,
} from '#/lib/rom/execute-jobs.ts'

import { sceneDthPath } from '#/lib/rom/houdini-jobs.ts'

import type { ExecuteSceneStatus, ExportRunProgress, RunnerGate } from '#/lib/rom/api.ts'
import type { HoudiniProjectImports } from '#/lib/rom/execute-jobs.ts'
import type {
  ExportPipelineView,
  ExportProgressBar,
} from '#/components/character/export-pipeline-panel.tsx'
import type { HoudiniRunState } from '#/lib/rom/houdini-jobs.ts'
import type { HoudiniRunMode, RunChoice, StampedLogStore } from '#/lib/rom/execute-jobs.ts'
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
 * Runner renames it, the button becomes a live **Working** state — the
 * Runner owns the file's `progress` + per-job statuses, the studio just polls
 * the file (api/execute.ts). At 100% the studio deletes the file and toasts
 * the outcome (including per-scene failures); a run whose Daz exited early
 * toasts a failure instead. A plain click on the working button is IGNORED
 * (a stray click must not reset the run's watch) — holding **Ctrl** turns it
 * into **Abort** (see {@link ExportProgressButton}): the claimed job file is
 * deleted and the button reset, which is the only way out of a batch that
 * stalled inside a Daz that is still running. Status refreshes on window
 * focus and polls lightly while pending/running.
 */
/** The DazToHue brand mark as a button icon. The button's automatic icon
 *  sizing only targets SVGs, so the img sizes itself — `size-6`, larger than
 *  the svg default; the mark's fine detail needs it. The host button keeps
 *  `px-3` by hand for the same reason (`has-[>svg]` doesn't see an img). */
function DthLogo() {
  return <img src={dthLogo} alt="" aria-hidden className="size-6 shrink-0 object-contain" />
}

const EXPORT_TOAST_ID = 'dth-export-finished'
const HOUDINI_TOAST_ID = 'dth-houdini-finished'

/**
 * The finish reports are STICKY toasts (`duration: Infinity`): a batch runs for
 * many minutes while the user is away in Daz or Houdini, and a toast on a
 * 4-second timer is gone long before they come back. They leave on exactly
 * three things — the toast's own close button (the global Toaster renders
 * one), a NEW run starting from the dialog (the outcome is superseded), and
 * the editor unmounting (navigated away; the report belongs to the page whose
 * run it was).
 */
function dismissFinishToasts() {
  toast.dismiss(EXPORT_TOAST_ID)
  toast.dismiss(HOUDINI_TOAST_ID)
}

/** Status texts arrive lowercase from the logs — tooltips lead with a capital. */
function capitalizeStatus(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A live digital clock riding a progress button (`04:12`, all four digits
 *  always rendered; an hour-plus run grows to `1:04:12`) — self-ticking each
 *  second, so the watch's 2.5s poll doesn't own the cadence. Renders nothing
 *  when the start is unknown (another window's run, adopted for display).
 *  Reserved width + tabular digits: the tick never resizes the button. */
function ElapsedSince({ since }: { since?: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (since === undefined) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [since])
  if (since === undefined) return null
  return (
    <span className="inline-block min-w-[5ch] text-left tabular-nums">
      {formatClock(Date.now() - since)}
    </span>
  )
}

/**
 * The live **Working** button — inert to plain clicks — and, while **Ctrl** is
 * held, the way out of a run that is never going to end: the same **Abort**
 * the pending state offers, in the phase where aborting is normally over (the
 * Runner has claimed the file and owns it from then on).
 *
 * It exists because the claimed file is the one the studio cannot clean up by
 * itself: the watch only deletes it at progress 100 or when Daz is gone, so a
 * Runner that stalled mid-batch — or a batch this window merely ADOPTED for
 * display and can never consume — leaves the button spinning and every later
 * export and scan refusing with "a batch is waiting for Daz Studio".
 *
 * Its own component for the reason the header's Save/Discard pair is one:
 * `useModifierHeld` flips on every Ctrl press AND release, and holding that up
 * in `DthExportAction` would re-render its whole subtree (the scene dialog
 * included) on each flip.
 *
 * The honest limit — which the tooltip states rather than implies: deleting the
 * job file stops the STUDIO, not Daz. A Runner that is genuinely working keeps
 * working through the batch it already parsed (and may write the file again on
 * its next row). What this reliably ends is this window's watch and the block
 * the file puts on the next handoff.
 */
function ExportProgressButton({
  progress,
  aborting,
  onAbort,
}: {
  progress: Extract<ExportRunProgress, { state: 'running' }>
  aborting: boolean
  onAbort: () => void
}) {
  const ctrlHeld = useModifierHeld('Control')
  if (ctrlHeld) {
    return (
      <Button
        variant="outline-destructive"
        className="px-3"
        disabled={aborting}
        onClick={onAbort}
        title="Abort (Ctrl): deletes the job file and resets this button. A batch Daz Studio has already started keeps running there — this ends the studio's watch and unblocks the next export."
      >
        <Ban /> {aborting ? 'Aborting…' : 'Abort'}
      </Button>
    )
  }
  // The Runner renamed the job file and owns its progress — the studio just
  // polls the file. A plain click is IGNORED: a stray click must never reset
  // the watch mid-run (measured: it did, and read as "the export vanished").
  // Ctrl+click (above) is the one deliberate way out; the wait-cursor says
  // "busy, not clickable" on hover.
  // The mini bar (::after, appears only in the collapsed header — styles.css)
  // mirrors the pipeline's CURRENT meter: the per-scene progress-log percent,
  // falling back to row counts under an old Runner.
  const percent =
    progress.step?.percent ??
    (progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0)
  return (
    <Button
      variant="outline"
      className="export-button-progress cursor-wait px-3"
      style={
        {
          '--export-progress': `${percent}%`,
          '--export-progress-color': 'var(--color-emerald-600)',
        } as CSSProperties
      }
      // Just the latest status — counts live in the panel; Ctrl (the abort)
      // reveals itself the moment it is held.
      title={capitalizeStatus(progress.step?.message || 'working…')}
    >
      {/* Just "Working" — the counts and percents live in the pipeline
          panel above (and this button's tooltip); a constant label plus the
          reserved-width clock keeps the button from resizing every tick. The
          DAZ mark names which app is doing the work — the run happens
          outside the studio, and this button is where the user looks to
          know who is busy (the Houdini leg below wears its own mark). */}
      <Loader2 className="animate-spin" />
      <img src={dazLogo} alt="Daz Studio" className="size-5 shrink-0 object-contain" />
      Working
      <ElapsedSince since={progress.startedAtMs} />
    </Button>
  )
}

export function DthExportAction({
  projectId,
  character,
  saving,
  dirty,
  dazLibraryConfigured,
  onPipeline,
}: {
  projectId: string
  character: Character
  saving: boolean
  dirty: boolean
  /** “My DAZ 3D Library” is set — where the job file and scripts live. */
  dazLibraryConfigured: boolean
  /** The run's live pipeline view (task cards + the tail-mode log), reported
   *  up so the header can render {@link ExportPipelinePanel} ABOVE the whole
   *  button cluster (this component only owns its own buttons). Null = no run. */
  onPipeline?: (view: ExportPipelineView | null) => void
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
  // The run's task identity (the selection the user started), armed at Start —
  // what the header's task cards are built from. Null = no run of OURS (an
  // adopted foreign run still shows the log, just no cards).
  const pipelineRef = useRef<{
    daz: Array<{ path: string; label: string }>
    /** `networks` = the scene stems the project will export (the DazToHue
     *  networks are matched per scene) — the card tooltip names them. */
    houdini: Array<{ path: string; label: string; networks: Array<string> }>
  } | null>(null)
  const [pipeline, setPipeline] = useState<ExportPipelineView | null>(null)
  // Ref mirrors of the two legs' states, for the OTHER leg's poller: the
  // interval closures are armed once, so reading the state there is stale.
  const progressRef = useRef<typeof progress>(null)
  const houdiniRef = useRef<typeof houdini>(null)
  useEffect(() => {
    progressRef.current = progress
  }, [progress])
  useEffect(() => {
    houdiniRef.current = houdini
  }, [houdini])
  // Report the pipeline view up to the header (the panel spans the WHOLE
  // button cluster, which this component doesn't own).
  useEffect(() => {
    onPipeline?.(pipeline)
    // The setter from useState is identity-stable; re-arming on the callback
    // would churn for inline lambdas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline])

  /** File stem for a task-card label. */
  function stemOf(path: string): string {
    return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^./\\]+$/, '')
  }

  /**
   * Rebuild the header's pipeline view from the FRESH poll values (state
   * lags a poll behind, the refs don't). Chronology: the Daz scenes in run
   * order, then the Houdini projects in queue order. Daz statuses ride the
   * Runner's processed count; Houdini statuses ride the queue's report
   * entries + the currently watched project.
   */
  function publishPipeline(
    progressNow: ExportRunProgress | null,
    houdiniNow: HoudiniRunState | null,
  ) {
    const armed = pipelineRef.current
    // The log window must NEVER disappear mid-run (it did, in the states
    // between the legs — Houdini "starting", and between two nodes when the
    // activity channel goes quiet): every live state returns SOME log, with
    // the last captured Houdini lines carried across the quiet stretches.
    // Lines only — the scene lives on the active task card, the percent on
    // the meter, the latest status on the meter's label. Each line wears the
    // [HH:MM:SS] at which this poll first saw it.
    const now = new Date()
    const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':')
    // The opening lines: the legs are silent while the app they drive comes
    // up (Daz takes tens of seconds, hython opens the project before 456.py
    // says anything), and an empty log window there reads as "nothing is
    // happening". Each leg names what it is waiting for until its own first
    // line lands — stamped like any other, so the wait is visibly timed.
    const dazOpeningLine = dazLaunchedRef.current
      ? 'opening Daz Studio'
      : 'waiting for Daz Studio to pick the batch up'
    const houdiniOpeningLine = 'opening Houdini (hython)'
    const log = (() => {
      if (houdiniNow) {
        if (houdiniNow.state === 'running' && houdiniNow.activity) {
          // The HDA's own lines say "DazToHue: …" and nothing about WHERE —
          // the studio's own lines name their app, so these get told apart
          // the same way. (Our status lines already do; they keep theirs.)
          lastHoudiniLinesRef.current = houdiniNow.activity.lines.map((line) => `Houdini; ${line}`)
        }
        const lines =
          lastHoudiniLinesRef.current.length > 0
            ? lastHoudiniLinesRef.current
            : [houdiniOpeningLine]
        return { lines: stampLogLines(houdiniStampsRef.current, lines, stamp) }
      }
      if (progressNow && progressNow.state !== 'finished' && progressNow.state !== 'dead') {
        const lines =
          progressNow.state === 'running' && progressNow.step?.lines.length
            ? progressNow.step.lines
            : [dazOpeningLine]
        return { lines: stampLogLines(dazStampsRef.current, lines, stamp) }
      }
      return null
    })()
    // The full-width meter row above tasks+log. `current` = the unit under
    // work; `overall` joins in only when the leg spans several units (scenes /
    // networks) — the two-level display. Labels carry the latest STATUS text,
    // never the scene name — that's what the active task card is for.
    const bars = ((): ExportPipelineView['bars'] => {
      // Once the Houdini leg exists it owns the meters — the Daz batch is
      // finished and reported by the time a project starts opening.
      if (houdiniNow?.state === 'running') {
        const total = houdiniNow.total
        const activity = houdiniNow.activity
        // The latest status text: the newest captured HDA line, else the
        // leg's own state.
        // The same prefixed spelling the log window shows.
        const newest = activity?.lines.at(-1)
        const status = newest ? `Houdini; ${newest}` : 'exporting…'
        // The stepwise scale the run can actually measure: opening the
        // project is one step, each DazToHue network another — hython's
        // console speaks in phase lines, never percents. `running` means the
        // project IS open, so that step already counts.
        const stepwisePct = total > 0 ? ((1 + houdiniNow.done) / (1 + total)) * 100 : 100
        if (total > 1) {
          // Within the ACTIVE network the only signal is the HDA's phase
          // lines (measured: 9 on a full node run) — a coarse estimate,
          // capped so it never claims a network done. The current bar names
          // the network's SCENE (it appears on no card — cards are per
          // project) plus the status.
          const phasePct = activity ? Math.min((activity.lines.length / 9) * 100, 95) : 0
          const network =
            activity?.scene || `network ${Math.min(houdiniNow.done + 1, total)}/${total}`
          return {
            overall: {
              percent: stepwisePct,
              label: `Networks ${houdiniNow.done}/${total}`,
              kind: 'houdini',
            },
            current: {
              percent: phasePct,
              label: activity ? `${network}: ${status}` : network,
              kind: 'houdini',
            },
          }
        }
        return { current: { percent: stepwisePct, label: status, kind: 'houdini' } }
      }
      if (houdiniNow?.state === 'starting') {
        return { current: { percent: 0, label: houdiniOpeningLine, kind: 'houdini' } }
      }
      if (progressNow?.state === 'running') {
        const step = progressNow.step
        // Per-scene percent straight from the Runner's progress log; an old
        // Runner writes none — the bar then rests at 0 while the overall one
        // (row counts) still moves.
        const currentPct = step?.percent ?? 0
        const current: ExportProgressBar = {
          percent: currentPct,
          label: step?.message || dazOpeningLine,
          kind: 'daz',
        }
        if (progressNow.total > 1) {
          const done = Math.min(progressNow.processed, progressNow.total)
          return {
            overall: {
              percent: ((done + currentPct / 100) / progressNow.total) * 100,
              label: `Scenes ${done}/${progressNow.total}`,
              kind: 'daz',
            },
            current,
          }
        }
        return { current }
      }
      // Handed off, not yet claimed: a meter at 0 that NAMES the wait beats a
      // bare log line with no bar under it.
      if (progressNow?.state === 'pending') {
        return { current: { percent: 0, label: dazOpeningLine, kind: 'daz' } }
      }
      return null
    })()
    // Arm the current bar's per-step clock: the silent minutes inside one
    // synchronous exporter call tick visibly instead of reading as stuck.
    // Any new log line or label flip is a new step; the ref survives polls.
    if (bars) {
      const stepKey = `${log?.lines.join('\n') ?? ''}|${bars.current.label}`
      if (stepStartRef.current?.key !== stepKey) {
        stepStartRef.current = { key: stepKey, atMs: Date.now() }
      }
      bars.current.sinceMs = stepStartRef.current.atMs
    } else {
      stepStartRef.current = null
    }
    if (!armed) {
      // A run this window has no memory of starting (a reloaded window, a
      // batch from elsewhere) — adopted for display. The Daz cards come from
      // the job file's OWN rows; only what never left the starting window's
      // memory stays absent (the Houdini queue's cards, the elapsed clock).
      const tasks =
        progressNow?.state === 'running' && progressNow.rows
          ? // A row without a scene (the contract's "new empty scene" row —
            // e.g. the genesis-index build) has no card-worthy identity.
            progressNow.rows
              .filter((row) => row.scenePath)
              .map((row) => ({
              id: `daz:${row.scenePath}`,
              label: stemOf(row.scenePath),
              kind: 'daz' as const,
              status:
                row.status === 'done' || row.status === 'failed'
                  ? ('done' as const)
                  : row.status === 'running'
                    ? ('active' as const)
                    : ('waiting' as const),
            }))
          : []
      setPipeline(tasks.length > 0 || log || bars ? { tasks, log, bars } : null)
      return
    }
    const report = runReportRef.current
    const dazFinished = report?.daz !== undefined || armed.daz.length === 0
    const processed =
      progressNow?.state === 'running' ? progressNow.processed : dazFinished ? armed.daz.length : 0
    const houdiniDone = report?.houdini.length ?? 0
    const houdiniActive = houdiniNow !== null ? currentHipRef.current : ''
    setPipeline({
      tasks: [
        ...armed.daz.map((scene, index) => ({
          id: `daz:${scene.path}`,
          label: scene.label,
          kind: 'daz' as const,
          status:
            dazFinished || processed > index
              ? ('done' as const)
              : processed === index && progressNow?.state === 'running'
                ? ('active' as const)
                : ('waiting' as const),
        })),
        ...armed.houdini.map((hip, index) => ({
          id: `hou:${hip.path}`,
          label: hip.label,
          // The networks it will export, ONE PER LINE under the full project
          // name — a comma-joined list wrapped into a wall of text. Each is
          // named by the scene whose `.dth` the HDA node imports (the actual
          // node paths only exist mid-run, inside Houdini).
          detail: hip.networks.length > 0 ? hip.networks.join('\n') : undefined,
          kind: 'houdini' as const,
          status:
            index < houdiniDone
              ? ('done' as const)
              : hip.label === houdiniActive && houdiniNow !== null
                ? ('active' as const)
                : ('waiting' as const),
        })),
      ],
      log,
      bars,
    })
  }

  // The last lines the Houdini activity channel showed — the log window keeps
  // them up through the quiet stretches (between nodes, project opening)
  // instead of blanking. Reset per project (startHoudiniQueue) and at run end.
  const lastHoudiniLinesRef = useRef<Array<string>>([])
  // First-seen `[HH:MM:SS]` stamps for the two legs' log tails (the on-disk
  // logs carry no timestamps — see stampLogLines).
  const dazStampsRef = useRef<StampedLogStore>({ lines: [], stamps: [] })
  const houdiniStampsRef = useRef<StampedLogStore>({ lines: [], stamps: [] })
  // When the CURRENT step began — feeds the meter's per-step clock. Keyed on
  // the log tail + the bar's label: any new line (or state flip) resets it.
  const stepStartRef = useRef<{ key: string; atMs: number } | null>(null)
  // Did THIS run start Daz itself? Only then is "opening Daz Studio" the truth
  // — a handoff to a running Daz is waiting for its Runner to claim the batch.
  const dazLaunchedRef = useRef(false)

  /** The run is over (reported, dead or aborted) — drop the panel. */
  function clearPipeline() {
    pipelineRef.current = null
    lastHoudiniLinesRef.current = []
    dazStampsRef.current = { lines: [], stamps: [] }
    houdiniStampsRef.current = { lines: [], stamps: [] }
    stepStartRef.current = null
    dazLaunchedRef.current = false
    setPipeline(null)
  }
  // A handoff written against a SHUTTING-DOWN Daz (running process, batch
  // never claimed) — the modal below waits out the exit and relaunches.
  const [dazClosing, setDazClosing] = useState(false)
  // The Houdini projects still WAITING their turn (+ the scene scope they run
  // on). Sequential by design: the Houdini job/result files are per-character
  // singletons, so two live runs would clobber each other — project n+1 starts
  // only when n's watch reports. A ref, not state: the poll interval's closure
  // is armed once (see the `watching` effect) and state would go stale in it.
  const houdiniQueueRef = useRef<{ projects: Array<string>; scenes: Array<string> } | null>(null)
  /**
   * The WHOLE run's outcome, accumulated across the Daz batch and every queued
   * Houdini project. The finish toast fires ONCE, at the very end, off this —
   * a per-leg toast mid-run read as "done" while Houdini was still working.
   * Refs like the queue: the poll interval's closure is armed once.
   */
  const runReportRef = useRef<{
    daz?: { total: number; failed: number; errors: Array<string>; elapsedMs?: number }
    houdini: Array<{ line: string; failed: boolean; elapsedMs?: number }>
  } | null>(null)
  /** The project the LIVE Houdini run belongs to — attribution for its line. */
  const currentHipRef = useRef('')

  /** The one end-of-everything toast: a line for the Daz leg, one per Houdini
   *  project, the failures inline, and the total time across all legs. */
  function emitFinalReport() {
    clearPipeline()
    const report = runReportRef.current
    runReportRef.current = null
    if (!report) return
    const lines: Array<string> = []
    let anyFailed = false
    let totalMs = 0
    let totalKnown = true
    if (report.daz) {
      const d = report.daz
      anyFailed ||= d.failed > 0
      const scenes = `${d.total - d.failed}/${d.total} scene${d.total === 1 ? '' : 's'}`
      lines.push(
        `Daz: ${scenes} exported${d.elapsedMs !== undefined ? ` in ${formatElapsed(d.elapsedMs)}` : ''}`,
      )
      lines.push(...d.errors)
      if (d.elapsedMs === undefined) totalKnown = false
      else totalMs += d.elapsedMs
    }
    for (const leg of report.houdini) {
      anyFailed ||= leg.failed
      lines.push(leg.line)
      if (leg.elapsedMs === undefined) totalKnown = false
      else totalMs += leg.elapsedMs
    }
    const title = `DTH Export finished${totalKnown && totalMs > 0 ? ` in ${formatElapsed(totalMs)}` : ''}.`
    const options = {
      id: EXPORT_TOAST_ID,
      duration: Infinity,
      description: lines.join('\n') || undefined,
    }
    if (anyFailed) toast.warning(title, options)
    else toast.success(title, options)
  }

  /** Start the next Houdini export run and park the rest in the queue. */
  async function startHoudiniQueue(projects: Array<string>, scenes: Array<string>) {
    const [first, ...rest] = projects
    if (!first) return
    if (runReportRef.current === null) runReportRef.current = { houdini: [] }
    houdiniQueueRef.current = rest.length > 0 ? { projects: rest, scenes } : null
    const stem = (first.split(/[\\/]/).pop() ?? first).replace(/\.[^./\\]+$/, '')
    currentHipRef.current = stem
    // A fresh project must not open showing the previous project's lines.
    lastHoudiniLinesRef.current = []
    try {
      await startHoudiniExport({
        data: { projectId, id: character.id, hipPath: first, scenes },
      })
      setHoudini({ state: 'starting', startedAtMs: Date.now() })
      publishPipeline(progressRef.current, { state: 'starting', startedAtMs: Date.now() })
      // NO hand-over toast: the pipeline panel already shows the baton pass
      // (mid-run toasts read as outcomes) — the one report comes at the END.
    } catch (err) {
      // A project that cannot start must not strand the ones behind it — its
      // failure joins the report and the queue moves on.
      runReportRef.current?.houdini.push({
        line: `${stem}: could not start — ${err instanceof Error ? err.message : String(err)}`,
        failed: true,
      })
      const remaining = houdiniQueueRef.current
      houdiniQueueRef.current = null
      if (remaining) {
        void startHoudiniQueue(remaining.projects, remaining.scenes)
      } else {
        emitFinalReport()
      }
    }
  }

  // The one status refresh: is a job file still waiting (→ Abort), and how far
  // is the in-memory export watch (→ Exporting n/m)? Runs on mount + window
  // focus (tabbing back from Daz) and polls while either state is live.
  async function refreshStatus() {
    // The watcher id lets a RELOADED window restore its own run from the
    // handoff sidecar (full ownership: clock, finish report, the Houdini
    // continuation) — anyone else's run stays a display-only adoption.
    const [isPending, run] = await Promise.all([
      exporterJobsPending(),
      fetchExportRunProgress(character.id),
    ])
    setPending(isPending)
    // '' = a batch adopted for display only (a scene-card ROM generate, a run
    // this window didn't start, or a sentinel run like the Tools genesis-index
    // build — fetchExportRunProgress maps those to '' for editor callers and
    // never lets them consume the outcome): the Runner is busy either way, so
    // every editor's button shows the live progress — outcomes stay owner-only.
    if (!run || (run.characterId !== '' && run.characterId !== character.id)) {
      setProgress(null)
      return
    }
    if (run.state === 'finished') {
      // The studio deleted the finished job file — the batch is done. Whether
      // that IS the end decides who reports: with a Houdini export
      // continuation ahead, the outcome is only STASHED (a "finished" toast
      // while Houdini still works read as "all done" — measured on the first
      // live run) and the one sticky report fires after the last project.
      setProgress(null)
      const continuing =
        run.houdiniProjects.length > 0 && run.failed < run.total && run.houdiniMode !== 'open'
      if (continuing) {
        runReportRef.current = {
          daz: {
            total: run.total,
            failed: run.failed,
            errors: run.errors,
            elapsedMs: run.elapsedMs,
          },
          houdini: [],
        }
        // A window that RELOADED during the Daz leg and polls late enough to
        // find the batch already finished never re-armed its cards (that path
        // needs a 'running' poll) — the continuation would then run with an
        // empty card column. The finished state carries the plan; the Daz
        // cards are done anyway, so the Houdini ones are the whole list.
        if (!pipelineRef.current) {
          pipelineRef.current = {
            daz: [],
            houdini: run.houdiniProjects.map((path) => ({
              path,
              label: stemOf(path),
              networks: run.scenes.map(stemOf),
            })),
          }
        }
        // Every Daz card drops (the report's daz entry marks the leg done).
        publishPipeline(null, houdiniRef.current)
        // No toast here — the panel shows the handover; the report comes at
        // the very end of the whole process.
        void startHoudiniQueue(
          run.houdiniProjects,
          run.houdiniMode === 'export-all'
            ? [character.scenePath, ...character.extraScenes].filter(Boolean)
            : run.scenes,
        )
        return
      }
      // No export continuation — the batch IS the whole process: report now.
      const scenes = `${run.total} scene${run.total === 1 ? '' : 's'}`
      const took = run.elapsedMs !== undefined ? ` in ${formatElapsed(run.elapsedMs)}` : ''
      if (run.failed > 0) {
        toast.warning(`DTH Export finished — ${run.failed} of ${scenes} failed${took}.`, {
          id: EXPORT_TOAST_ID,
          duration: Infinity,
          description: run.errors.length ? run.errors.join('\n') : undefined,
        })
      } else {
        toast.success(`DTH Export finished — ${scenes} exported${took}.`, {
          id: EXPORT_TOAST_ID,
          duration: Infinity,
        })
      }
      // No continuation — the run ends here, and its cards with it.
      clearPipeline()
      // Open only (single-project by the dialog's own rule): opening is not a
      // watched leg — the report above stands, the project just opens.
      if (run.houdiniProjects.length > 0 && run.failed < run.total && run.houdiniMode === 'open') {
        toast.info('Opening the Houdini project…')
        void openScene({ data: { scenePath: run.houdiniProjects[0] } }).catch((err: unknown) => {
          toast.error(
            `Couldn't open the Houdini project: ${err instanceof Error ? err.message : String(err)}`,
          )
        })
      }
      return
    }
    if (run.state === 'dead') {
      setProgress(null)
      clearPipeline()
      // As sticky as the finish: a run dying while the user is away must not
      // evaporate before they return.
      toast.error(
        'DTH Export did not finish — Daz Studio is no longer running (or the job file disappeared).',
        { id: EXPORT_TOAST_ID, duration: Infinity },
      )
      return
    }
    // 'pending' renders through the Abort button (isPending); only a live
    // Runner-owned run shows the progress state.
    setProgress(run.state === 'running' ? run : null)
    // A sidecar-restored watch (this window reloaded mid-run): the module
    // watch is whole again, but the component's armed selection is not —
    // re-arm the task cards from the run itself, once. Rows carry the Daz
    // leg; the persisted plan carries the Houdini projects (their network
    // tooltip shows the batch's scenes — export-all's exact scope is
    // recomputed at the continuation as always).
    if (
      run.state === 'running' &&
      run.characterId === character.id &&
      !pipelineRef.current &&
      run.rows
    ) {
      pipelineRef.current = {
        daz: run.rows
          .filter((row) => row.scenePath)
          .map((row) => ({ path: row.scenePath, label: stemOf(row.scenePath) })),
        houdini: (run.houdiniProjects ?? []).map((path) => ({
          path,
          label: stemOf(path),
          networks: (run.scenes ?? []).map(stemOf),
        })),
      }
    }
    publishPipeline(run, houdiniRef.current)
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
      // A bare "nothing to export" is undiagnosable — point at the console
      // log, which names what was wanted vs found and survives the run.
      const summary =
        run.summary || 'nothing to export (details: .dth_houdini_console.log in the character folder)'
      const took = run.elapsedMs !== undefined ? ` in ${formatElapsed(run.elapsedMs)}` : ''
      // The HDA's pre-flight check asks "Continue anyway?" and 456.py answers
      // Yes — so the run report is the only place its complaints are ever
      // seen, and the result file holding them is deleted as this run ends.
      const detail = [run.error, ...run.problems].filter(Boolean).join(' · ')
      const report = runReportRef.current
      if (report) {
        report.houdini.push({
          line: `${currentHipRef.current || 'Houdini'}: ${summary}${took}${detail ? ` — ${detail}` : ''}`,
          failed: run.failed > 0 || Boolean(run.error),
          elapsedMs: run.elapsedMs,
        })
      }
      // More projects waiting their turn — the next one starts now that the
      // job/result files are free again; the report keeps accumulating.
      const queued = houdiniQueueRef.current
      if (queued) {
        houdiniQueueRef.current = null
        void startHoudiniQueue(queued.projects, queued.scenes)
        return
      }
      // The LAST leg of the whole process — now the one report fires.
      if (report) {
        emitFinalReport()
      } else {
        clearPipeline()
        // No accumulated run (a watch armed outside the queue) — report this
        // leg alone, the pre-report behavior.
        const options = {
          id: HOUDINI_TOAST_ID,
          duration: Infinity,
          description: detail || undefined,
        }
        if (run.failed > 0 || run.error) {
          toast.warning(`Houdini export finished — ${summary}${took}.`, options)
        } else {
          toast.success(`Houdini export finished — ${summary}${took}.`, options)
        }
      }
      return
    }
    if (run.state === 'dead') {
      setHoudini(null)
      clearPipeline()
      // Houdini itself is gone — starting the next project would open a fresh
      // Houdini nobody asked for. Drop the rest of the queue; what already
      // finished rides the error as context, so it isn't lost with the run.
      houdiniQueueRef.current = null
      const report = runReportRef.current
      runReportRef.current = null
      const done = report
        ? [
            ...(report.daz
              ? [`Daz: ${report.daz.total - report.daz.failed}/${report.daz.total} exported`]
              : []),
            ...report.houdini.map((leg) => leg.line),
          ].join('\n')
        : ''
      toast.error('The Houdini export did not finish — Houdini is no longer running.', {
        id: HOUDINI_TOAST_ID,
        duration: Infinity,
        description: done || undefined,
      })
      return
    }
    setHoudini(run)
    publishPipeline(progressRef.current, run)
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
  // Navigating away removes the sticky finish reports — they belong to the
  // page whose run they describe (mount-only; the cleanup IS the point).
  useEffect(() => dismissFinishToasts, [])

  async function onAbort() {
    setAborting(true)
    try {
      await abortExporterJobs({ data: { projectId, id: character.id } })
      setPending(false)
      clearPipeline()
      toast.success('Pending export jobs aborted — the job file was deleted.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setAborting(false)
    }
  }

  /**
   * Ctrl+click on the live progress button: delete the job file(s) and reset
   * this button. The counterpart to {@link onAbort} for the phase AFTER the
   * Runner claimed the batch — a run that stalled in Daz, or one this window
   * only adopted for display and could therefore never consume.
   *
   * Deliberately NOT {@link abortExporterJobs}: that one deletes the pending
   * file and rolls the character's handoff stamps back, and neither fits here.
   * The claimed file is the one to remove ({@link clearExporterJobFiles} takes
   * both names and drops the in-memory watch with them), and the batch may well
   * have exported scenes already — re-flagging those as never handed off would
   * describe work that DID happen as work that didn't.
   */
  async function onAbortRunning() {
    setAborting(true)
    try {
      const removed = await clearExporterJobFiles()
      // The watch dies with the file either way — clearExporterJobFiles drops
      // the api-side run, these two drop this button's own state, and the busy
      // cursor is released by the `running` effect on the same render.
      dismissExportRun()
      setProgress(null)
      setPending(false)
      clearPipeline()
      toast.success(
        removed.length > 0
          ? `Export aborted — deleted ${removed.join(' and ')}. Anything Daz Studio already started keeps running there.`
          : 'Export watch reset — the job file was already gone.',
      )
    } catch (error) {
      // A locked file: the watch is NOT reset (the blockage is still there) —
      // saying so beats a cheerful "aborted" that changed nothing.
      toast.error(
        `Couldn't delete the job file: ${error instanceof Error ? error.message : String(error)}`,
      )
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
    return (
      <ExportProgressButton
        progress={progress}
        aborting={aborting}
        onAbort={() => void onAbortRunning()}
      />
    )
  }

  if (houdini) {
    // The Daz batch is done and reported; Houdini is working (or opening the
    // project). Like the Daz leg's button, a plain click is IGNORED — the
    // STUDIO drives the project queue, so a stray click didn't just stop the
    // watch, it silently stopped the orchestration of every queued project.
    // A watch whose Houdini actually dies ends itself (liveness detection).
    // The mini bar mirrors the panel's stepwise Houdini scale (1 open-project
    // step + 1 per network).
    const houdiniPercent =
      houdini.state === 'running' && houdini.total > 0
        ? Math.round(((1 + houdini.done) / (1 + houdini.total)) * 100)
        : 0
    return (
      <Button
        variant="outline"
        className="export-button-progress cursor-wait px-3"
        style={
          {
            '--export-progress': `${houdiniPercent}%`,
            '--export-progress-color': 'var(--color-orange-600)',
          } as CSSProperties
        }
        // Just the latest status, like the Daz leg's button.
        title={capitalizeStatus(
          (houdini.state === 'running' && houdini.activity?.lines.at(-1)) ||
            (houdini.state === 'running' ? 'exporting…' : 'opening project…'),
        )}
      >
        {/* Same constant "Working" as the Daz leg — the node counts live in
            the pipeline panel's meters and this tooltip; the Houdini mark is
            what tells the legs apart. */}
        <Loader2 className="animate-spin" />
        <img src={houdiniLogo} alt="Houdini" className="size-5 shrink-0 object-contain" />
        Working
        <ElapsedSince
          since={houdini.state === 'starting' || houdini.state === 'running' ? houdini.startedAtMs : undefined}
        />
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
          onExported={(run) => {
            // A new run supersedes the previous outcome (see dismissFinishToasts).
            dismissFinishToasts()
            runReportRef.current = null
            setPending(true)
            // The header's task cards: the run's selection in run order —
            // the Daz scenes, then the Houdini projects (rom-only continues
            // into nothing, so its houdini list is already empty here).
            dazLaunchedRef.current = run.dazLaunched
            pipelineRef.current = {
              daz: run.scenes.map((path) => ({ path, label: stemOf(path) })),
              houdini: run.houdiniProjects.map((path) => ({
                path,
                label: stemOf(path),
                networks: run.houdiniScenes.map(stemOf),
              })),
            }
            publishPipeline(null, houdiniRef.current)
            // Arm the progress view right away (0/n until Daz delivers).
            void refreshStatus()
          }}
          // A skip-Daz run hands its selection straight to the Houdini queue —
          // the same machinery the after-batch continuation drives.
          onHoudiniQueue={(projects, scenes) => {
            dismissFinishToasts()
            runReportRef.current = null
            pipelineRef.current = {
              daz: [],
              houdini: projects.map((path) => ({
                path,
                label: stemOf(path),
                networks: scenes.map(stemOf),
              })),
            }
            void startHoudiniQueue(projects, scenes)
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
 * job file is then picked up on launch. It also stands down (no relaunch) when
 * a LIVE Daz claims late and actually starts working the batch — that run
 * belongs to the export watch. Closing the modal only stops the watch: the
 * batch stays queued (the header button still aborts it), and it vanishes on
 * its own when the batch gets claimed after all or is aborted.
 */
function WaitForDazCloseModal({
  onDone,
  onCancel,
}: {
  /** The wait resolved: `started` = Daz was launched (or runs again) for the
   *  pending batch; false = nothing to launch — the handoff disappeared
   *  (aborted) or a live Daz claimed late and is working it (the export
   *  watch's run now). */
  onDone: (started: boolean) => void
  onCancel: () => void
}) {
  useEffect(() => {
    let active = true
    let settled = false
    const id = window.setInterval(() => {
      void (async () => {
        // Wait for the process to actually be gone, then hand the decision to
        // `launchDazForPendingJobs` — it is the one that knows whether there is
        // anything left to run.
        //
        // It used to bail the moment the PENDING file disappeared, on the
        // assumption that "claimed or aborted" both mean "not my problem". But
        // a Daz that is closing can claim the batch (the rename) and exit
        // before running a row, which looks identical from here — so the dialog
        // closed, nothing launched, and the batch sat orphaned in a `running_`
        // file the Runner never polls for. That is now reclaimed instead.
        //
        // The EXPORT installation, not "any Daz": this waits for the process
        // that has to restart to run the batch, and with "Export only" set,
        // another open Daz would keep the modal spinning forever.
        const running = await exportDazStudioRunning()
        if (!active || settled) return
        if (running) {
          // A LIVE Daz can also claim late — stuck on a modal Save prompt past
          // the pickup window, or restarted by the user. Once the claimed
          // batch shows real work it is the export watch's run, and "waiting
          // for Daz to close" would only invite killing it mid-batch — stand
          // down. Mere "pending gone while Daz runs" is NOT enough to settle:
          // that is exactly the closing-Daz claim this modal exists to rescue.
          if (await exporterJobsWorking()) {
            if (!active || settled) return
            settled = true
            onDone(false)
          }
          return
        }
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
   *  run at all (Export only needs a saved ROM animation; Houdini only needs
   *  the scene's last Daz export on disk). */
  mode: RunChoice
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
  // Houdini only runs off the DELIVERED export — a scene without one on disk
  // has nothing to rely on. The `.duf` is deliberately NOT consulted here:
  // Houdini reads the export, not the scene, so even a missing scene file
  // stays runnable in this mode.
  const noExport = mode === 'houdini-only' && !loading && !status.exportExists
  const disabled = mode === 'houdini-only' ? noExport : status.missing || noRom
  // Each mode reports the state that decides ITS pre-selection ("Houdini only"
  // has no staleness signal, so nothing highlights green there).
  const highlight =
    mode === 'houdini-only'
      ? false
      : mode === 'export-only'
        ? status.romUnexported
        : status.affected
  const hint =
    mode === 'houdini-only'
      ? loading
        ? 'Checking for exports…'
        : noExport
          ? 'No Daz export on disk yet — run ROM + Export for this scene first'
          : 'Uses this scene’s last Daz export as it stands'
      : status.missing
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
        {/* z-10 lifts the real controls above the row's cover button.
            Disabled only when NOT already checked: a refused row must not be
            checkable, but one that is ALREADY checked (the status can go stale
            under the selection — the pre-handoff re-check surfaces it) must
            still be possible to UNCHECK, or the gate's "unselect it" advice
            would be advice nobody can follow. */}
        <input
          type="checkbox"
          className="relative z-10 size-4 shrink-0 accent-daz-green"
          aria-label={`Export ${displayName}`}
          checked={checked}
          disabled={disabled && !checked}
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
              status.missing && mode !== 'houdini-only'
                ? 'text-destructive'
                : noRom || noExport
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

/** The Daz **Mode** dropdown, in the user's words. Order is the offer order;
 *  `rom-export` leads because it is the default full run. */
const DAZ_MODE_OPTIONS: ReadonlyArray<{ mode: RunChoice; title: string; blurb: string }> = [
  {
    mode: 'rom-export',
    title: 'ROM + Export',
    blurb: 'Build a fresh ROM, save the ROM animation scene, then export everything.',
  },
  {
    mode: 'rom-only',
    title: 'ROM only',
    blurb: 'Build the ROM and save the ROM animation scene, skipping the export.',
  },
  {
    mode: 'export-only',
    title: 'Export only',
    blurb: 'Export the saved ROM animations as they stand, without rebuilding.',
  },
  {
    mode: 'houdini-only',
    title: 'Skip Daz — use last exports',
    blurb: 'Run nothing in Daz; the Houdini projects work off each scene’s last export.',
  },
]

/** The Houdini **Mode** dropdown — what the selected projects do when their
 *  turn comes (see {@link HoudiniRunMode} for the single-project rule). */
const HOUDINI_MODE_OPTIONS: ReadonlyArray<{ mode: HoudiniRunMode; title: string; blurb: string }> = [
  {
    mode: 'open',
    title: 'Open only',
    blurb: 'Just open the project — needs exactly one selected.',
  },
  {
    mode: 'export-selected',
    title: 'Export selected scenes',
    blurb: 'Run the DazToHue exports for the checked Daz scenes.',
  },
  {
    mode: 'export-all',
    title: 'Export all',
    blurb: 'Run the DazToHue exports for every linked Daz scene.',
  },
]

/** One selectable Houdini project — the scene rows' sibling card: checkbox,
 *  the Houdini mark as its tile, the project stem over its hint, and the full
 *  `houdini-card` look (orange tint + border + accent bar) the linked-project
 *  card wears on the character page — in orange what the Daz rows are in
 *  green, selected ring included. The hint
 *  is a status line like the scene rows': normally the project's short
 *  location (the tail of the path — the stem already carries the name), and a
 *  loud "missing on disk" when the `.hip` is gone — a run started on one of
 *  those could only fail after the fact. */
function HipRow({
  hip,
  checked,
  missing,
  onToggle,
}: {
  hip: string
  checked: boolean
  /** The `.hip` can't be found on disk — the row is refused (an already-checked
   *  one can still be UNchecked, like the scene rows' stale-status rule). */
  missing: boolean
  onToggle: () => void
}) {
  const stem = (hip.split(/[\\/]/).pop() ?? hip).replace(/\.[^./\\]+$/, '')
  // The tail of the path — enough to tell twins apart without the wall of
  // drive/project prefix the full path wastes the line on.
  const parts = hip.replace(/\\/g, '/').split('/').filter(Boolean)
  const shortPath = parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : hip.replace(/\\/g, '/')
  return (
    <div className="group/card relative w-full">
      <div
        className={`houdini-card relative flex items-center gap-3 rounded-lg border p-3 pl-4${missing ? ' opacity-50' : ''}`}
        data-selected={checked ? 'true' : undefined}
      >
        <input
          type="checkbox"
          className="relative z-10 size-4 shrink-0 accent-houdini-orange"
          aria-label={`Run in ${stem}`}
          checked={checked}
          disabled={missing && !checked}
          onChange={onToggle}
        />
        <span className="flex aspect-[3/4] h-[56px] shrink-0 items-center justify-center rounded-md bg-[#262626]">
          <img src={houdiniLogo} alt="" aria-hidden className="size-8 object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{stem}</span>
          <p
            className={`mt-0.5 truncate text-xs ${missing ? 'text-destructive' : 'text-muted-foreground'}`}
            title={hip.replace(/\\/g, '/')}
          >
            {missing ? 'Project file missing on disk — relink it in the editor' : shortPath}
          </p>
        </div>
      </div>
      {/* Row-wide toggle as a transparent cover, like the scene rows. */}
      {!missing && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onToggle}
          className="absolute inset-0 rounded-lg"
        />
      )}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-houdini-orange" />
    </div>
  )
}

function DthExportDialog({
  projectId,
  character,
  onClose,
  onExported,
  onHoudiniQueue,
  onDazClosing,
}: {
  projectId: string
  character: Character
  onClose: () => void
  /** A handoff was written — the header button flips to Abort. Carries the
   *  run's selection (run order) for the header's task cards; `houdiniProjects`
   *  is empty when the Houdini leg won't run exports (open-only, rom-only),
   *  `houdiniScenes` = the scene scope that leg will export (its networks). */
  onExported: (run: {
    scenes: Array<string>
    houdiniProjects: Array<string>
    houdiniScenes: Array<string>
    /** The handoff started Daz itself (vs. handing to a running one). */
    dazLaunched: boolean
  }) => void
  /** A skip-Daz run handed its selection straight to Houdini (no Daz batch) —
   *  the caller starts the sequential project queue on these scenes. */
  onHoudiniQueue: (projects: Array<string>, scenes: Array<string>) => void
  /** The handoff went to a Daz that is still shutting down — the caller shows
   *  the wait-and-relaunch modal (see WaitForDazCloseModal). */
  onDazClosing: () => void
}) {
  // Rows render immediately from the linked scenes; the affected-detection
  // (one stat + signature per scene) fills in and pre-checks the changed ones.
  const [status, setStatus] = useState<Array<ExecuteSceneStatus> | null>(null)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  // The Daz Mode dropdown. The ref mirrors it for the scene probe (kicked off
  // at mount), which seeds the pre-selection whenever it lands.
  const [mode, setMode] = useState<RunChoice>('rom-export')
  const modeRef = useRef<RunChoice>('rom-export')
  // The Houdini list's selection + its Mode dropdown. `export-selected` is the
  // default the moment a project joins the run; `open` is single-project only
  // (houdiniModeForSelection flips it back when a second project is picked).
  const [checkedHips, setCheckedHips] = useState<ReadonlySet<string>>(new Set())
  const [houdiniMode, setHoudiniMode] = useState<HoudiniRunMode>('export-selected')
  // Projects whose `.hip` is gone from disk — their rows are refused up front
  // (startHoudiniExport would throw, but only after the run was armed). The
  // ref twins the state for the scene probe's auto-selection, which may run
  // before OR after this probe lands.
  const [hipMissing, setHipMissing] = useState<ReadonlySet<string>>(new Set())
  const hipMissingRef = useRef<ReadonlySet<string>>(new Set())
  // What each linked project's networks IMPORT, from the stored scan (no
  // hython here — a `.hip` costs tens of seconds to open). Drives the
  // scene→project auto-selection; a project the sweep hasn't reached yet
  // simply isn't in this list and is never un-ticked on that ignorance.
  const [hipImports, setHipImports] = useState<Array<HoudiniProjectImports>>([])
  // null = still checking (Start stays off for the moment the probe takes).
  const [runner, setRunner] = useState<RunnerGate | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all(
      character.houdiniProjects.map(async (hip) => ({
        hip,
        // A throwing probe must not mark a real project missing — only a
        // definite "not there" refuses the row.
        exists: await fileExists({ data: { path: hip } }).catch(() => true),
      })),
    ).then((probed) => {
      if (!active) return
      const missing = new Set(probed.filter((p) => !p.exists).map((p) => p.hip))
      hipMissingRef.current = missing
      setHipMissing(missing)
      // Strip missing projects out of whatever is already selected (the
      // auto-selection may have landed first and taken everything).
      if (missing.size > 0) {
        setCheckedHips((prev) => new Set([...prev].filter((hip) => !missing.has(hip))))
      }
    })
    return () => {
      active = false
    }
    // Mount-only, like the scene probe — the list can't change while modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let active = true
    void fetchCachedHoudiniScans({ data: { projectId, id: character.id } })
      .then((scans) => {
        if (!active) return
        setHipImports(scans.map((scan) => ({ hipPath: scan.hipPath, imports: scan.imports })))
      })
      .catch(() => {
        // Read-only convenience: no scan, no auto-adjust — the list simply
        // keeps whatever the user picked.
      })
    return () => {
      active = false
    }
    // Mount-only, like the probes above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      exportExists: false,
    }))

  /**
   * The "Export only" Start gate: SELECTED scenes with no saved ROM animation
   * ({@link scenesMissingRomAnimation} — the same rule the pre-handoff re-check
   * in `onExport` applies). With a landed, CURRENT status the row controls keep
   * such scenes out of the selection, so this stays empty; it fires when the
   * status under the selection has gone STALE — the re-check writes its fresh
   * probe back via `setStatus`, and this then disables Start, shows the notice
   * naming the scenes, and marks the refused rows. A CHECKED refused row can
   * still be unchecked (see the checkbox in {@link SceneRow}), so the notice's
   * "unselect it" advice is real. While the probe is still in flight nothing is
   * known — the gate stays empty and Start waits as "Checking scenes…" instead
   * (`checking` below).
   */
  const noRomChecked = scenesMissingRomAnimation(mode, status, checked)
  /** The skip-Daz Start gate, {@link noRomChecked}'s sibling: selected scenes
   *  whose last Daz export is not on disk — nothing to rely on. Moot under
   *  "Export all" (the checked scenes don't scope that run) — and under
   *  "Open only", which consumes no export at all (it just opens the one
   *  picked `.hip`; see `onExport`). */
  const noExportChecked =
    houdiniMode === 'export-all' || houdiniMode === 'open'
      ? []
      : scenesMissingExport(mode, status, checked)
  // The probe (one stat per scene) is sub-second; holding Start for it closes
  // the window where a row checked mid-flight could start with unknown state.
  // Both artifact-gated modes wait it out the same way.
  const checking = (mode === 'export-only' || mode === 'houdini-only') && status === null

  useEffect(() => {
    let active = true
    fetchExecuteScenes({ data: { projectId, id: character.id } })
      .then((scenes) => {
        if (!active) return
        setStatus(scenes)
        // Seed the checks for whichever mode is current when the probe lands.
        const pre = preCheckedScenes(modeRef.current, scenes)
        setChecked(pre)
        // Scenes with outstanding work → their Houdini projects join the run
        // too, so a plain Start does the WHOLE round trip. WHICH projects is
        // settled by the effect below (it also re-runs on every later change
        // of the scene selection); this only seeds the untouched case with
        // every linked project, which the effect then narrows the moment the
        // stored scans say what each one imports. Never under rom-only: that
        // run writes no export, so there is no continuation to arm (see
        // hipSelectionAfterToggle for the full why).
        if (pre.size > 0 && modeRef.current !== 'rom-only' && character.houdiniProjects.length > 0) {
          setCheckedHips((prev) =>
            prev.size > 0
              ? prev
              : new Set(character.houdiniProjects.filter((hip) => !hipMissingRef.current.has(hip))),
          )
        }
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
              // export-only (or Houdini-only) pick possible when the probe
              // failed — the pre-handoff re-probe still gates the real run.
              romExists: true,
              romUnexported: false,
              exportExists: true,
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

  // The scene selection DECIDES which Houdini projects belong in the run: a
  // project joins when one of its networks imports a selected scene's `.dth`
  // — the same key 456.py matches on at export time — so ticking a scene off
  // takes its project with it. Runs on every change of the scene selection
  // (whatever changed it: a toggle, Solo, All, a mode re-seed), and again when
  // the stored scans land. Projects the scan hasn't reached keep whatever they
  // have (`hipsForSelectedScenes` never drops one on ignorance), and missing
  // `.hip`s stay out. Not under rom-only — that list is a manual OPEN pick.
  useEffect(() => {
    if (mode === 'rom-only' || hipImports.length === 0) return
    const scenesDth = [...checked]
      .map((scene) => sceneDthPath(character, scene))
      .filter((dth) => dth !== '')
    // EVERY linked project is judged — a project the scan never reached is
    // absent from the store, and leaving it out of the list here would drop it
    // by omission, which is the very guess the rule refuses to make.
    const byPath = new Map(hipImports.map((entry) => [entry.hipPath, entry.imports]))
    const judged = character.houdiniProjects.map((hipPath) => ({
      hipPath,
      imports: byPath.get(hipPath) ?? [],
    }))
    setCheckedHips((prev) => {
      const next = hipsForSelectedScenes(judged, scenesDth, prev)
      for (const hip of hipMissing) next.delete(hip)
      // Same members → same object, so the Houdini list doesn't re-render (and
      // `houdiniModeForSelection` isn't re-run) on every unrelated poll.
      if (next.size === prev.size && [...next].every((hip) => prev.has(hip))) return prev
      return next
    })
  }, [checked, hipImports, hipMissing, mode, character])

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
  /** The Daz Mode dropdown: each mode has its own "outstanding work" rule, so
   *  changing it re-seeds which scenes start checked. */
  function pickMode(next: RunChoice) {
    modeRef.current = next
    setMode(next)
    if (status) setChecked(preCheckedScenes(next, status))
    // ROM only writes no fresh export, so a Houdini continuation has nothing
    // of THIS run's to consume — whatever the list had armed (auto-selection
    // included) doesn't carry over, and the one thing it can still do is OPEN
    // a project the user re-picks deliberately.
    if (next === 'rom-only') {
      setCheckedHips(new Set())
      setHoudiniMode('open')
    }
  }

  /** The Houdini list's toggle. "Open only" is a single-project affair —
   *  picking a second project flips the mode to the default export run
   *  ({@link houdiniModeForSelection}) instead of refusing the pick. */
  function toggleHip(hip: string) {
    // Under rom-only the toggle is a radio — the pure rule owns why.
    const next = hipSelectionAfterToggle(mode, checkedHips, hip)
    setCheckedHips(next)
    setHoudiniMode((m) => houdiniModeForSelection(m, next.size))
  }

  async function onExport() {
    setBusy(true)
    try {
      const chosenScenes = rows.filter((r) => checked.has(r.scenePath)).map((r) => r.scenePath)
      const chosenHips = character.houdiniProjects.filter((hip) => checkedHips.has(hip))
      // Skip Daz: the Houdini selection IS the run — the same machinery the
      // after-batch continuation drives, minus the batch.
      if (mode === 'houdini-only') {
        if (houdiniMode === 'open') {
          toast.info('Opening the Houdini project…')
          await openScene({ data: { scenePath: chosenHips[0] } })
          onClose()
          return
        }
        // Belt and braces, the export-only re-probe's sibling: the dialog's
        // status is a snapshot, and an export folder can be cleared while it
        // sits open — a vanished `.dth` must land back in the dialog, not in
        // a Houdini session with nothing to import. ("Export all" scopes by
        // every linked scene instead, and the Houdini side skips gracefully.)
        if (houdiniMode === 'export-selected') {
          const fresh = await fetchExecuteScenes({ data: { projectId, id: character.id } })
          const missing = scenesMissingExport('houdini-only', fresh, checked)
          if (missing.length > 0) {
            setStatus(fresh)
            const names = missing.map((s) =>
              (s.scenePath.split(/[\\/]/).pop() ?? s.scenePath).replace(/\.[^./\\]+$/, ''),
            )
            toast.error(
              `No Daz export on disk for ${names.join(', ')} — run ROM + Export first, or unselect ${missing.length === 1 ? 'it' : 'them'}.`,
            )
            return
          }
        }
        onHoudiniQueue(chosenHips, houdiniMode === 'export-all' ? linked : chosenScenes)
        onClose()
        return
      }
      // Belt and braces for "Export only": the dialog's scene status is a
      // snapshot from when it opened, and the selection can outlive it — a ROM
      // animation deleted since then (in Daz, by hand) would ride the stale
      // go-ahead into the handoff. Re-probe at the decision point; a refusal
      // lands the fresh status in the dialog (the gate's notice + disabled
      // Start + the rows' real state) instead of a failure after the fact.
      if (mode === 'export-only') {
        const fresh = await fetchExecuteScenes({ data: { projectId, id: character.id } })
        const missing = scenesMissingRomAnimation('export-only', fresh, checked)
        if (missing.length > 0) {
          setStatus(fresh)
          const names = missing.map((s) =>
            (s.scenePath.split(/[\\/]/).pop() ?? s.scenePath).replace(/\.[^./\\]+$/, ''),
          )
          toast.error(
            `No saved ROM animation for ${names.join(', ')} — run a ROM build first, or unselect ${missing.length === 1 ? 'it' : 'them'}.`,
          )
          return
        }
      }
      const result = await executeCharacterJobs({
        // Preserve row order — the jobs run top to bottom.
        data: {
          projectId,
          id: character.id,
          scenes: chosenScenes,
          mode,
          houdiniProjects: chosenHips,
          houdiniMode,
        },
      })
      onExported({
        scenes: chosenScenes,
        houdiniProjects: mode === 'rom-only' || houdiniMode === 'open' ? [] : chosenHips,
        // The scene scope the Houdini leg will export (→ the networks its
        // task cards name) — the continuation recomputes the same set.
        houdiniScenes: houdiniMode === 'export-all' ? linked : chosenScenes,
        // Whether the handoff STARTED Daz — the log window's opening line
        // says "opening Daz Studio" only when that is what is happening.
        dazLaunched: result.dazLaunched,
      })
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
          DTH Export
          <InfoPopup label="DTH Export — more information">
            Pick the Daz scenes and what their run does, then the Houdini projects that carry
            on with the results. Scenes with outstanding work come pre-selected — and so do
            the Houdini projects when they have. The wand picks a single scene, a
            double-click selects all.
          </InfoPopup>
        </span>
      }
      dismissible={!busy}
    >
      <p className="text-xs text-muted-foreground">
        {mode === 'houdini-only'
          ? 'Skips Daz entirely — the selected Houdini projects run their DazToHue exports off each scene’s last Daz export.'
          : mode === 'export-only'
            ? 'Exports each selected scene’s saved ROM animation as it stands — no rebuild, so this is the quick one.'
            : 'Heads up: this takes a long time — Daz Studio plays through the full ROM for every selected scene.'}
      </p>
      <div>
        <Label className="mb-1.5">Daz scenes</Label>
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
                      .filter((r) =>
                        mode === 'houdini-only'
                          ? r.exportExists
                          : !r.missing && (mode !== 'export-only' || r.romExists),
                      )
                      .map((r) => r.scenePath),
                  ),
                )
              }
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Label className="shrink-0" htmlFor="daz-mode">
            Mode
          </Label>
          <Select value={mode} onValueChange={(value) => pickMode(value as RunChoice)}>
            <SelectTrigger id="daz-mode" className="w-80">
              {/* Explicit children: SelectValue would otherwise mirror the whole
                  two-line item (title + blurb) into the closed trigger. */}
              <SelectValue>{DAZ_MODE_OPTIONS.find((o) => o.mode === mode)?.title}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {DAZ_MODE_OPTIONS.map((option) => (
                <SelectItem key={option.mode} value={option.mode}>
                  <span className="block">
                    {option.title}
                    <span className="block text-xs text-muted-foreground">{option.blurb}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {character.houdiniProjects.length > 0 && (
        <div>
          <Label className="mb-1.5">Houdini projects</Label>
          <div className="space-y-2">
            {character.houdiniProjects.map((hip) => (
              <HipRow
                key={hip}
                hip={hip}
                checked={checkedHips.has(hip)}
                missing={hipMissing.has(hip)}
                onToggle={() => toggleHip(hip)}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Label className="shrink-0" htmlFor="houdini-mode">
              Mode
            </Label>
            <Select
              value={houdiniMode}
              onValueChange={(value) => setHoudiniMode(value as HoudiniRunMode)}
              // Inert without a selected project — and without a checked Daz
              // scene, when the whole run has nothing to start from.
              disabled={checkedHips.size === 0 || checked.size === 0}
            >
              <SelectTrigger id="houdini-mode" className="w-80">
                {/* Title only — see the Daz trigger above. */}
                <SelectValue>
                  {HOUDINI_MODE_OPTIONS.find((o) => o.mode === houdiniMode)?.title}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {HOUDINI_MODE_OPTIONS.map((option) => (
                  <SelectItem
                    key={option.mode}
                    value={option.mode}
                    // "Open only" is a single-project affair — see
                    // houdiniModeForSelection for the auto-flip on a 2nd pick.
                    // The EXPORT modes are dead under ROM only: that run
                    // writes no fresh export, so they could only re-consume
                    // the previous ones (hipSelectionAfterToggle has the why).
                    disabled={
                      option.mode === 'open' ? checkedHips.size !== 1 : mode === 'rom-only'
                    }
                  >
                    <span className="block">
                      {option.title}
                      <span className="block text-xs text-muted-foreground">{option.blurb}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      {/* The Runner gate is the DAZ plugin's — a skip-Daz run never goes
          through it, so it must not block one. */}
      {mode !== 'houdini-only' && runner?.blocked && <RunnerGateNotice gate={runner} />}
      {noRomChecked.length > 0 && (
        <div className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <p>
            <strong>Export only</strong> exports the saved ROM animation of each scene, and{' '}
            {noRomChecked.length === 1 ? 'one selected scene has none' : `${noRomChecked.length} selected scenes have none`}{' '}
            yet:
          </p>
          <ul className="list-inside list-disc text-muted-foreground">
            {noRomChecked.map((row) => (
              <li key={normalizeSceneKey(row.scenePath)}>
                {(row.scenePath.split(/[\\/]/).pop() ?? row.scenePath).replace(/\.[^./\\]+$/, '')}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Run <strong>ROM + Export</strong> or <strong>ROM only</strong> for{' '}
            {noRomChecked.length === 1 ? 'it' : 'them'} first, or unselect{' '}
            {noRomChecked.length === 1 ? 'it' : 'them'}.
          </p>
        </div>
      )}
      {noExportChecked.length > 0 && (
        <div className="space-y-1 rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm">
          <p>
            <strong>Skip Daz</strong> relies on each scene&apos;s last Daz export, and{' '}
            {noExportChecked.length === 1 ? 'one selected scene has none' : `${noExportChecked.length} selected scenes have none`}{' '}
            on disk:
          </p>
          <ul className="list-inside list-disc text-muted-foreground">
            {noExportChecked.map((row) => (
              <li key={normalizeSceneKey(row.scenePath)}>
                {(row.scenePath.split(/[\\/]/).pop() ?? row.scenePath).replace(/\.[^./\\]+$/, '')}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">
            Run <strong>ROM + Export</strong> for {noExportChecked.length === 1 ? 'it' : 'them'}{' '}
            first, or unselect {noExportChecked.length === 1 ? 'it' : 'them'}.
          </p>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={
            busy ||
            checking ||
            (mode === 'houdini-only' && houdiniMode === 'open'
              ? // "Open only" consumes ONLY the Houdini pick (`onExport` opens
                // `chosenHips[0]` and never reads the Daz-scene selection or
                // the exports), so neither of those may gate it.
                checkedHips.size === 0
              : // No scenes = nothing to start from, whatever the modes say.
                checked.size === 0 ||
                (mode === 'houdini-only'
                  ? checkedHips.size === 0 || noExportChecked.length > 0
                  : !runner || runner.blocked || noRomChecked.length > 0))
          }
          title={
            mode !== 'houdini-only' && runner?.blocked
              ? 'The Runner plugin needs attention in Settings first'
              : checking
                ? mode === 'houdini-only'
                  ? 'Checking each scene for a Daz export on disk — a moment'
                  : 'Checking each scene for a saved ROM animation — a moment'
                : mode === 'houdini-only' && houdiniMode === 'open'
                  ? // Open-only's single requirement — the Daz-scene wording
                    // below would name a selection this run never reads.
                    checkedHips.size === 0
                    ? 'Select the Houdini project to open'
                    : undefined
                  : checked.size === 0
                    ? 'Select at least one Daz scene'
                    : mode === 'houdini-only'
                      ? checkedHips.size === 0
                        ? 'Select at least one Houdini project'
                        : noExportChecked.length > 0
                          ? 'Every selected scene needs a Daz export on disk to skip Daz — see above'
                          : undefined
                      : noRomChecked.length > 0
                        ? 'Every selected scene needs a saved ROM animation for an export-only run — see above'
                        : undefined
          }
          onClick={() => void onExport()}
        >
          {checking ? <Loader2 className="animate-spin" /> : <Play />}{' '}
          {busy ? 'Starting…' : checking ? 'Checking scenes…' : 'Start'}
        </Button>
      </div>
    </Modal>
  )
}
