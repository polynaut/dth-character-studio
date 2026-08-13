import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { AlertTriangle, Ban, Loader2, Play, Wand } from 'lucide-react'
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
import unrealLogo from '#/assets/unreal-logo.svg'
import { Portrait } from '#/components/portrait.tsx'
import { PrimaryBadge } from '#/components/primary-badge.tsx'
import { RunnerGateNotice } from '#/components/runner-gate-notice.tsx'
import {
  abortExporterJobs,
  adoptHoudiniRun,
  clearExporterJobFiles,
  dismissExportRun,
  dismissHoudiniRun,
  executeCharacterJobs,
  exportDazStudioRunning,
  exporterJobsPending,
  exporterJobsWorking,
  fetchExecuteScenes,
  fetchExportRunProgress,
  dismissUnrealImport,
  fetchCachedHoudiniScans,
  fetchUnrealImportProgress,
  fetchExportRunnerGate,
  fetchHoudiniRunProgress,
  fetchSceneDthPaths,
  fetchUnrealSendPlan,
  fileExists,
  openUnrealForPendingJob,
  launchDazForPendingJobs,
  startHoudiniExport,
  startUnrealImport,
} from '#/lib/rom/api.ts'
import { holdBusyCursor } from '#/lib/busy-cursor.ts'
import {
  dazTaskCards,
  houdiniTaskCards,
  runPercent,
  unrealTaskCards,
} from '#/lib/rom/export-cards.ts'
import {
  EXPORT_MODE_LABELS,
  formatClock,
  formatElapsed,
  hipsForSelectedScenes,
  normalizeSceneKey,
  preCheckedScenes,
  scenesMissingExport,
  scenesMissingRomAnimation,
} from '#/lib/rom/execute-jobs.ts'

import type {
  ExecuteSceneStatus,
  ExportRunProgress,
  RunnerGate,
  UnrealSendPlan,
} from '#/lib/rom/api.ts'
import type { HoudiniProjectImports } from '#/lib/rom/execute-jobs.ts'
import type { UnrealTarget } from '#/lib/rom/export-cards.ts'
import type {
  ExportPipelineView,
  ExportTask,
  ExportTaskKind,
} from '#/components/character/export-pipeline-panel.tsx'
import { HOUDINI_CONSOLE_FILE } from '#/lib/rom/houdini-jobs.ts'
import type { HoudiniRunState } from '#/lib/rom/houdini-jobs.ts'
import type { UnrealImportState } from '#/lib/rom/unreal-jobs.ts'
import type { ExportMode, HoudiniRunMode, RunChoice } from '#/lib/rom/execute-jobs.ts'
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
 * stalled inside a Daz that is still running. The Houdini leg's button works
 * the same way (see {@link HoudiniProgressButton}) — Ctrl reveals **Stop
 * watching**, which drops the project queue with it; since that leg runs
 * headless there is no window left to close instead. Status refreshes on
 * window focus and polls lightly while pending/running.
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

/**
 * The Houdini leg's twin of {@link ExportProgressButton}: a live **Working**
 * button, inert to plain clicks, with **Ctrl** revealing the way out.
 *
 * The Ctrl affordance is not decoration. The studio drives the project QUEUE,
 * so this watch is also the orchestration of every project still waiting —
 * and since the leg went headless there is no Houdini window left to close
 * either. Without it a wedged run, or a queue the user changed their mind
 * about, could only be ended by quitting the studio.
 *
 * What it can honestly promise is what the plain click always promised: the
 * studio stops watching and the queue is dropped. The export already running
 * inside hython keeps going — nothing here can reach into it.
 */
function HoudiniProgressButton({
  houdini,
  queued,
  onStopWatching,
}: {
  houdini: HoudiniRunState
  /** Projects still waiting their turn — they die with the watch, so the
   *  tooltip has to say so before the user commits. */
  queued: number
  onStopWatching: () => void
}) {
  const ctrlHeld = useModifierHeld('Control')
  if (ctrlHeld) {
    return (
      <Button
        variant="outline-destructive"
        className="px-3"
        onClick={onStopWatching}
        title={`Stop watching (Ctrl): the export keeps running in Houdini — this ends the studio's watch${queued > 0 ? ` and the ${queued} queued project${queued === 1 ? '' : 's'} will not start` : ''}.`}
      >
        <Ban /> Stop watching
      </Button>
    )
  }
  // The Daz batch is done and reported; Houdini is working (or opening the
  // project). Like the Daz leg's button, a plain click is IGNORED — a stray
  // click didn't just stop the watch, it silently stopped the orchestration of
  // every queued project. A watch whose Houdini actually dies ends itself
  // (liveness detection). The mini bar mirrors the panel's stepwise Houdini
  // scale (1 open-project step + 1 per network).
  const percent =
    houdini.state === 'running' && houdini.total > 0
      ? Math.round(((1 + houdini.done) / (1 + houdini.total)) * 100)
      : 0
  return (
    <Button
      variant="outline"
      className="export-button-progress cursor-wait px-3"
      style={
        {
          '--export-progress': `${percent}%`,
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
        since={
          houdini.state === 'starting' || houdini.state === 'running' ? houdini.startedAtMs : undefined
        }
      />
    </Button>
  )
}

/** A stable empty default for the optional linked-`.uproject` list — a fresh
 *  `[]` per render is a new reference every time (and the lint gate says so). */
const NO_UNREAL_PROJECTS: ReadonlyArray<string> = []

/** The empty checkbox selection, shared so a "nothing selected" render is the
 *  same object every time (it is set on every ineligible poll). */
const EMPTY_SELECTION: ReadonlySet<string> = new Set()

export function DthExportAction({
  projectId,
  character,
  saving,
  dirty,
  dazLibraryConfigured,
  unrealProjects = NO_UNREAL_PROJECTS,
  onPipeline,
}: {
  projectId: string
  character: Character
  saving: boolean
  dirty: boolean
  /** “My DAZ 3D Library” is set — where the job file and scripts live. */
  dazLibraryConfigured: boolean
  /** The PROJECT's linked `.uproject`s (per-project, not per-character) — the
   *  dialog's third leg. Empty = no Unreal section at all. */
  unrealProjects?: ReadonlyArray<string>
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
    /** What the Daz batch does to each scene — the scene rows' subtitle
     *  ("ROM + Export", "Export only"). Undefined on a run this window only
     *  adopted: the job file it reads never carried the dialog's choice. */
    dazMode?: ExportMode
    /** `networks` = the scene stems the project will export (the DazToHue
     *  networks are matched per scene) — the card tooltip names them. */
    houdini: Array<{
      path: string
      label: string
      networks: Array<string>
      /** What the scan says this project WRITES (its export nodes'
       *  `character_name`) — what names the cards before the run can. */
      sets?: Array<string>
    }>
    /** The Unreal projects the export is handed to when the queue drains —
     *  the run's third leg, and ONE ROW PER EXPORT SET, because that is one
     *  import job each: a project taking two characters is two rows. */
    unreal: Array<UnrealTarget>
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
   * The run's Unreal rows: every selected project, each carrying the export
   * sets it is getting — one import job, and therefore one row, apiece.
   *
   * `located` is the dialog's probe (which project already holds which set),
   * which is what turns a row into "Re-import" or "First import". It is absent
   * for a run RESTORED after a reload — the plan carries the set names, not the
   * probe — and those rows then say a plain "Import" rather than picking one of
   * the two answers on no evidence. The send fills it in for real
   * ({@link sendToUnreal}).
   */
  function unrealTargetsFrom(
    paths: ReadonlyArray<string>,
    sets: ReadonlyArray<string>,
    located?: Record<string, Record<string, string>>,
  ): Array<UnrealTarget> {
    return paths.map((path) => ({
      path,
      label: stemOf(path),
      sets: sets.map((name) => ({
        name,
        ...(located ? { existing: located[path]?.[name] !== undefined } : {}),
      })),
    }))
  }

  /**
   * Rebuild the header's task list from the FRESH poll values (state lags a
   * poll behind, the refs don't).
   *
   * ONE list, in the order the run works through it: every selected Daz scene,
   * then every DazToHue network of every Houdini project, then every export set
   * going into every Unreal project. Under it, ONE bar — how much of that list
   * is behind us — carrying the newest thing the run said as its status line.
   *
   * Daz statuses ride the Runner's processed count; Houdini statuses ride the
   * queue's report entries + the currently watched project; the Unreal rows
   * ride the send and the bridge's own result file.
   */
  function publishPipeline(
    progressNow: ExportRunProgress | null,
    houdiniNow: HoudiniRunState | null,
  ) {
    const armed = pipelineRef.current
    // The opening lines: the legs are silent while the app they drive comes
    // up (Daz takes tens of seconds, hython opens the project before 456.py
    // says anything), and a blank status line there reads as "nothing is
    // happening". Each leg names what it is waiting for until its own first
    // word lands.
    const dazOpeningLine = dazLaunchedRef.current
      ? 'Opening Daz Studio'
      : 'Waiting for Daz Studio to pick the batch up'
    const houdiniOpeningLine = 'Opening Houdini (hython)'
    // The ONE status line + how far into the ACTIVE row we are (0–1), from
    // whichever leg is talking. Only one ever is: the Daz batch is finished and
    // reported by the time a Houdini project starts opening, and the send waits
    // for the whole Houdini queue.
    const live = ((): { status: string; fraction: number; kind: ExportTaskKind } => {
      if (houdiniNow?.state === 'running') {
        // The HDA's own lines say "Baking textures 3/12…" and nothing about
        // WHERE — the studio's own lines name their app, so these get told
        // apart the same way.
        const newest = houdiniNow.activity?.lines.at(-1)
        // Within a network the only signal is the HDA's phase lines (measured:
        // 9 on a full node run) — a coarse estimate, capped so it never claims
        // a network finished before 456.py says so.
        const phase = houdiniNow.activity
          ? Math.min(houdiniNow.activity.lines.length / 9, 0.95)
          : 0
        return {
          status: newest ? `Houdini; ${newest}` : 'Exporting…',
          fraction: phase,
          kind: 'houdini',
        }
      }
      if (houdiniNow?.state === 'starting') {
        return { status: houdiniOpeningLine, fraction: 0, kind: 'houdini' }
      }
      if (progressNow?.state === 'running') {
        // Per-scene percent straight from the Runner's progress log; an old
        // Runner writes none, and the row then simply contributes nothing of
        // its own until it flips to done.
        const step = progressNow.step
        return {
          status: capitalizeStatus(step?.message || dazOpeningLine),
          fraction: (step?.percent ?? 0) / 100,
          kind: 'daz',
        }
      }
      if (progressNow?.state === 'pending') {
        return { status: dazOpeningLine, fraction: 0, kind: 'daz' }
      }
      // The Unreal leg outlives both: its status is whatever it last said (the
      // queue line, the wait for an editor, the outcome), and it has no
      // progress of its own to report — an import is claimed or it is not.
      if (unrealStatusRef.current) {
        return {
          status: unrealStatusRef.current,
          fraction: unrealRunRef.current?.state === 'running' ? 0.5 : 0,
          kind: 'unreal',
        }
      }
      return { status: '', fraction: 0, kind: 'daz' }
    })()

    const publish = (tasks: Array<ExportTask>) => {
      if (tasks.length === 0 && !live.status) {
        setPipeline(null)
        return
      }
      setPipeline({
        tasks,
        status: live.status,
        percent: runPercent(tasks, live.fraction),
        kind: live.kind,
      })
    }

    if (!armed) {
      // A run this window has no memory of starting (a reloaded window, a batch
      // from elsewhere) — adopted for display. The Daz rows come from the job
      // file's OWN rows; only what never left the starting window's memory
      // stays absent (the mode, the Houdini queue, the Unreal targets, the
      // elapsed clock).
      publish(
        progressNow?.state === 'running' && progressNow.rows
          ? dazTaskCards(
              // A row without a scene (the contract's "new empty scene" row —
              // e.g. the genesis-index build) has no row-worthy identity.
              progressNow.rows
                .filter((row) => row.scenePath)
                .map((row) => ({ path: row.scenePath, label: stemOf(row.scenePath) })),
              progressNow.mode,
              progressNow.processed,
              false,
              true,
            )
          : [],
      )
      return
    }
    const report = runReportRef.current
    const dazFinished = report?.daz !== undefined || armed.daz.length === 0
    const processed =
      progressNow?.state === 'running' ? progressNow.processed : dazFinished ? armed.daz.length : 0
    const houdiniDone = report?.houdini.length ?? 0
    const houdiniActive = houdiniNow !== null ? currentHipRef.current : ''
    // Queued is not done: the Unreal leg is done when the editor has imported
    // it (or said why it could not), which is minutes after the file write.
    // And "said why it could not" is a FAILED row, not a ticked one — including
    // the partial case, where some sets landed and the rest carried an error.
    const unrealNow = unrealRunRef.current
    const unrealStatus: ExportTask['status'] =
      unrealNow?.state === 'finished'
        ? unrealNow.error
          ? 'failed'
          : 'done'
        : unrealNow !== null || unrealSentRef.current
          ? 'active'
          : 'waiting'
    publish([
      ...dazTaskCards(
        armed.daz,
        armed.dazMode,
        processed,
        dazFinished,
        progressNow?.state === 'running',
      ),
      ...armed.houdini.flatMap((hip, index) =>
        houdiniTaskCards(
          hip,
          index,
          hip.label === houdiniActive && houdiniNow?.state === 'running' ? houdiniNow : null,
          hip.label === houdiniActive && houdiniNow !== null,
          houdiniDone,
        ),
      ),
      // Last, because it happens last: the send waits for every Houdini project
      // to finish. One row per export set per project — two characters going
      // into one project are two import jobs, and the list says so.
      ...armed.unreal.flatMap((target) => unrealTaskCards(target, unrealStatus)),
    ])
  }

  /**
   * The Unreal leg's latest word — the status line's source once the other two
   * have gone quiet ('' = it has not spoken).
   *
   * It gets a ref of its own because that leg reports LAST and outlives the
   * panel's other inputs: the send happens after the Houdini queue drains, and
   * the bridge's answer lands minutes later, from an editor the user may only
   * then have opened.
   */
  const unrealStatusRef = useRef('')
  // Did THIS run start Daz itself? Only then is "opening Daz Studio" the truth
  // — a handoff to a running Daz is waiting for its Runner to claim the batch.
  const dazLaunchedRef = useRef(false)

  /** The run is over (reported, dead or aborted) — drop the panel. */
  function clearPipeline() {
    pipelineRef.current = null
    unrealStatusRef.current = ''
    dazLaunchedRef.current = false
    setPipeline(null)
  }
  // A finished Unreal leg is the one state that never clears itself (its watch
  // ends by design — see refreshUnreal), so the next run would inherit it and
  // start with its rows already ticked. Every run start goes through here.
  function resetUnrealLeg() {
    unrealSentRef.current = false
    // The WATCH belongs to the run that armed it. Only a finished import clears
    // it, so a send whose editor was never opened keeps it forever — and since
    // `sendToUnreal` only arms a watch when there is none, the next run's
    // import would never be polled at all, while the previous project's files
    // answered in its name. A new run watches its own send or nothing.
    unrealWatchRef.current = ''
    unrealStatusRef.current = ''
    setUnrealState(null)
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
    /**
     * Pre-formatted lines INHERITED from a window that watched earlier legs and
     * is gone (a reload — see the adopt effect). Emitted verbatim ahead of this
     * window's own, and deliberately NOT folded into `houdini`: that array's
     * LENGTH is "how many Houdini projects have finished", which drives the
     * task cards. Folding the carried lines in there marked the RUNNING
     * project's card done the moment a restore landed — one inherited line per
     * finished leg PLUS the Daz leg's line and every Daz error.
     */
    carried?: Array<string>
    /** Whether any inherited leg failed — the report's tone, which the lines
     *  themselves can't carry. */
    carriedFailed?: boolean
    /** The Unreal leg's lines — one per selected project, added at the very
     *  end (it runs after the last Houdini project). */
    unreal?: Array<string>
  } | null>(null)
  /** The project the LIVE Houdini run belongs to — attribution for its line. */
  const currentHipRef = useRef('')
  /**
   * The Unreal projects this run finishes into — the dialog's third leg.
   *
   * A ref for the same reason as the queue: the poll interval's closure is
   * armed once. It rides the Houdini run plan too, so a window that reloads
   * mid-export still sends when the queue drains.
   */
  const unrealTargetsRef = useRef<Array<string>>([])
  /** WHICH export sets the send hands over — the dialog's tick list. Empty is
   *  meaningful ("send nothing"), so it travels beside the targets rather than
   *  defaulting to "everything" anywhere down the line. */
  const unrealSetsRef = useRef<Array<string>>([])
  /**
   * Each linked project's export-set names, from the STORED scan — the only
   * thing that can name a project's networks before hython has opened it.
   * Reported as "there should be two" while the log still said "Opening
   * Houdini": the run knows, minutes later, and the scan knew all along.
   */
  const hipSetsRef = useRef<Record<string, Array<string>>>({})
  useEffect(() => {
    let active = true
    void fetchCachedHoudiniScans({ data: { projectId, id: character.id } })
      .then((scans) => {
        if (!active) return
        hipSetsRef.current = Object.fromEntries(
          scans.map((scan) => [scan.hipPath, scan.exportSets]),
        )
      })
      .catch(() => {
        // No scan, no names — the cards fall back to one per project.
      })
    return () => {
      active = false
    }
    // Mount-only: a character cannot change under a mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /** Set once the send has run — the Unreal cards' `done`. (The targets ref is
   *  emptied by the send itself, so it cannot answer this.) */
  const unrealSentRef = useRef(false)
  /**
   * The Unreal leg's own watch: which project is importing, and what it says.
   *
   * It reports into the SAME log window and task column as the other two legs
   * — the run is one story. It briefly had a status panel of its own on the
   * character page, which was a second place to look for a third of one run.
   */
  const [unrealRun, setUnrealRun] = useState<UnrealImportState | null>(null)
  /**
   * The same value as a ref, for the same reason the other two legs keep one:
   * the poll interval's closures are armed once, so a `publishPipeline` reading
   * the STATE sees whatever it was when the interval was armed. The Unreal rows
   * are the ones that suffered — the leg's last state change is `finished`, and
   * it is also the last publish, so a stale read left every row spinning
   * forever on an import that had landed.
   */
  const unrealRunRef = useRef<UnrealImportState | null>(null)
  const setUnrealState = (state: UnrealImportState | null) => {
    unrealRunRef.current = state
    setUnrealRun(state)
  }
  const unrealWatchRef = useRef('')

  /**
   * Hand what the run just exported to the selected Unreal projects, and say so
   * in the end report.
   *
   * Runs when the WHOLE Houdini queue has drained: one job file per Unreal
   * project, each naming every export set the character has. Nothing is
   * watched afterwards — the send is a file write, and the editor picks it up
   * whenever it is next open (the character page's panel is where a live
   * import is followed).
   */
  async function sendToUnreal(): Promise<Array<string>> {
    const targets = unrealTargetsRef.current
    unrealTargetsRef.current = []
    if (targets.length === 0) return []
    unrealSentRef.current = true
    const lines = await Promise.all(
      targets.map(async (uprojectPath) => {
        const name = stemOf(uprojectPath)
        try {
          const started = await startUnrealImport({
            data: { projectId, id: character.id, uprojectPath, sets: unrealSetsRef.current },
          })
          const sets = started.sets.map((set) => set.name).join(', ')
          // The send is the moment the studio KNOWS which of these sets that
          // project already holds — it located them itself to write the job's
          // destinations. So the rows stop guessing and say re-import or first
          // import for real, each against the project it is going into.
          const armed = pipelineRef.current
          const target = armed?.unreal.find((one) => one.path === uprojectPath)
          if (target) {
            target.sets = started.sets.map((set) => ({ name: set.name, existing: set.existing }))
          }
          // Nothing claims a job when no editor is open — so open one. Five
          // seconds is the bridge's poll (1s) with room for a slow start; the
          // api refuses when anything is already running.
          window.setTimeout(() => {
            void openUnrealForPendingJob({ data: { uprojectPath } }).catch(() => {
              // queued either way — a failed launch is not a failed send
            })
          }, 5000)
          // The status line gets the same news the report will, as it happens.
          unrealStatusRef.current = `Unreal; queued for ${name} — waiting for the editor to pick the job up`
          // One project is watched — the handoff is one job at a time, and the
          // rows name the rest.
          if (!unrealWatchRef.current) unrealWatchRef.current = uprojectPath
          setUnrealState({ state: 'waiting' })
          return `Unreal: queued for ${name} — ${sets}`
        } catch (error) {
          // A refusal here (no bridge, no export) must not read as an export
          // failure: the Houdini leg is done and its output is on disk.
          return `Unreal: not queued for ${name} — ${error instanceof Error ? error.message : String(error)}`
        }
      }),
    )
    return lines
  }

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
    // Legs an earlier window watched, restored from the run plan — they lead,
    // because they happened first. Their timings died with that window, so a
    // restored run reports no total.
    if (report.carried?.length) {
      lines.push(...report.carried)
      anyFailed ||= report.carriedFailed === true
      totalKnown = false
    }
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
    // Last, because it happens last. A send that was refused says so on its own
    // line without souring the run's tone: the export itself still finished.
    if (report.unreal?.length) lines.push(...report.unreal)
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
    try {
      // The queue and the report ride along into the run's own sidecar, so a
      // window that reloads mid-leg can finish the WHOLE process: the projects
      // behind this one still start, and the end report still names the legs
      // this window never saw.
      const report = runReportRef.current
      await startHoudiniExport({
        data: {
          projectId,
          id: character.id,
          hipPath: first,
          scenes,
          remaining: rest,
          // Everything the end report will need that this project's own leg
          // won't produce — INCLUDING lines already inherited from a window
          // before this one, or a second reload would drop the first's legs.
          reportLines: [
            ...(report?.carried ?? []),
            ...(report?.daz
              ? [
                  `Daz: ${report.daz.total - report.daz.failed}/${report.daz.total} scene${report.daz.total === 1 ? '' : 's'} exported`,
                  ...report.daz.errors,
                ]
              : []),
            ...(report?.houdini.map((leg) => leg.line) ?? []),
          ],
          anyFailed:
            report?.carriedFailed === true ||
            (report?.daz?.failed ?? 0) > 0 ||
            (report?.houdini.some((leg) => leg.failed) ?? false),
          // The third leg rides along for the same reason as the queue: it
          // fires when the LAST project finishes, minutes from now, in a
          // window that may have reloaded since.
          unrealProjects: unrealTargetsRef.current,
          unrealSets: unrealSetsRef.current,
        },
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

  /** Poll the Unreal leg — cheap when nothing is armed (no watch, no read). */
  async function refreshUnreal() {
    const uprojectPath = unrealWatchRef.current
    if (!uprojectPath) return
    const state = await fetchUnrealImportProgress({ data: { uprojectPath } }).catch(() => null)
    setUnrealState(state)
    if (state?.state !== 'finished') return
    unrealWatchRef.current = ''
    // The outcome becomes the status line, like every other leg's — and it
    // lands minutes after the run's toast, so this is where it is read.
    const what = state.reimported ? 're-imported' : 'imported'
    const landed = `${what} ${state.assets} asset${state.assets === 1 ? '' : 's'}${
      state.destination ? ` in ${state.destination}` : ''
    }`
    // THREE outcomes, not two. The bridge imports each export set on its own and
    // reports `done` as long as one landed, so "some worked, some didn't" is a
    // real state — and it used to be reported as unqualified success, which is
    // the one thing this leg must never do.
    unrealStatusRef.current = !state.error
      ? `Unreal; ${landed}`
      : state.sets > 0
        ? `Unreal; ${landed} — but ${state.error}`
        : `Unreal; import failed — ${state.error}`
    publishPipeline(progressRef.current, houdiniRef.current)
    void dismissUnrealImport({ data: { uprojectPath } })
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
      // An ADOPTED display has nothing left once the batch it mirrored is gone
      // (its owner finished it and deleted the file): the poll then returns
      // null, the interval stops with it, and without this the cards, log
      // window and ticking meter would hang in the header until the user
      // navigated away. Only an adoption is dropped here — a run of OURS keeps
      // its panel, because the Houdini leg lives on long after the Daz job
      // files are deleted (pipelineRef/houdini are how that leg is armed).
      if (!pipelineRef.current && !houdiniRef.current) clearPipeline()
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
        run.houdiniProjects.length > 0 &&
        run.failed < run.total &&
        // `skip` means no Houdini leg at all — the projects may still be
        // CHECKED in the dialog (the list goes inert, it doesn't clear).
        run.houdiniMode !== 'skip'
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
              sets: hipSetsRef.current[path],
            })),
            unreal: unrealTargetsFrom(run.unrealProjects, run.unrealSets),
          }
        }
        // Every Daz card drops (the report's daz entry marks the leg done).
        publishPipeline(null, houdiniRef.current)
        // No toast here — the panel shows the handover; the report comes at
        // the very end of the whole process.
        // The Unreal targets came through the Daz run record, so a window that
        // reloaded during the batch still finishes into Unreal.
        unrealTargetsRef.current = run.unrealProjects
        unrealSetsRef.current = run.unrealSets
        void startHoudiniQueue(
          run.houdiniProjects,
          run.scenes,
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
      // No Houdini continuation — the run ends here, and its cards with it.
      // A SKIP run still has its third leg: no Houdini means the send happens
      // now, off the exports already on disk, instead of after a queue.
      clearPipeline()
      if (run.unrealProjects.length > 0 && run.failed < run.total) {
        unrealTargetsRef.current = run.unrealProjects
        unrealSetsRef.current = run.unrealSets
        void sendToUnreal().then((lines) => {
          if (lines.length > 0) toast.info(lines.join('\n'), { duration: Infinity })
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
    // re-arm the task rows from the run itself, once. Rows carry the Daz leg;
    // the persisted plan carries the Houdini projects and the scene scope its
    // networks are matched against.
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
        // What the batch does to each of them — restored from the run record,
        // because the job rows only name a script and this window never saw
        // the dialog that chose it.
        dazMode: run.mode,
        houdini: (run.houdiniProjects ?? []).map((path) => ({
          path,
          label: stemOf(path),
          networks: (run.scenes ?? []).map(stemOf),
        })),
        // A running batch's live progress carries no Unreal plan (only its
        // FINISHED snapshot does) — this window shows the rows it can name.
        unreal: [],
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
      // The LAST leg of the whole process — the export is on disk, so the
      // Unreal leg (if any) goes now, and its lines join the one report.
      const unrealLines = await sendToUnreal()
      if (report) {
        if (unrealLines.length > 0) report.unreal = unrealLines
        emitFinalReport()
      } else {
        clearPipeline()
        // No accumulated run (a watch armed outside the queue) — report this
        // leg alone, the pre-report behavior.
        const options = {
          id: HOUDINI_TOAST_ID,
          duration: Infinity,
          description: [detail, ...unrealLines].filter(Boolean).join('\n') || undefined,
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
      // …and no send: the export this run was going to hand over never
      // finished, so queueing one would import whatever was there before.
      unrealTargetsRef.current = []
      const report = runReportRef.current
      runReportRef.current = null
      const done = report
        ? [
            // Inherited legs first — a reloaded window's run can die too, and
            // what already finished must not be lost with it.
            ...(report.carried ?? []),
            ...(report.daz
              ? [`Daz: ${report.daz.total - report.daz.failed}/${report.daz.total} exported`]
              : []),
            ...report.houdini.map((leg) => leg.line),
          ].join('\n')
        : ''
      // Say WHY when the console log says why. "Houdini is no longer running"
      // is what the studio can see from outside; the log is what actually
      // happened, and it is one file away (see houdiniDeathReason).
      // The reason can be a RAW log line, which may already end in `.` (or the
      // `…` of a truncated one) — so the sentence only adds its full stop when
      // the line didn't bring one.
      const reason = run.reason ?? ''
      const tail = /[.!?…:]$/.test(reason) ? reason : `${reason}.`
      const why = reason
        ? `The Houdini export did not finish — ${tail}`
        : 'The Houdini export did not finish — Houdini is no longer running.'
      toast.error(why, {
        id: HOUDINI_TOAST_ID,
        duration: Infinity,
        description:
          [done, reason ? `Full output: ${HOUDINI_CONSOLE_FILE} in the character folder.` : '']
            .filter(Boolean)
            .join('\n') || undefined,
      })
      return
    }
    setHoudini(run)
    publishPipeline(progressRef.current, run)
  }
  // A Houdini leg still running when this window reloaded: the watch is memory
  // (and the leg is HEADLESS, so nothing on screen would say so), and with it
  // went the queue of projects behind it and the accumulated report. The run's
  // own sidecar carries all three — adopt it, re-arm the queue and the report,
  // and rebuild the cards. Mount-only: the character can't change under a
  // mounted editor, and a second adopt would fight the live watch.
  useEffect(() => {
    let active = true
    void adoptHoudiniRun({ data: { projectId, id: character.id } })
      .then((plan) => {
        if (!active || !plan) return
        currentHipRef.current = stemOf(plan.hipPath)
        houdiniQueueRef.current =
          plan.remaining.length > 0
            ? { projects: plan.remaining, scenes: plan.sceneScope }
            : null
        // The Unreal leg is part of the plan too — without this, a reload
        // between the export and its send silently drops the send.
        unrealTargetsRef.current = plan.unrealProjects
        unrealSetsRef.current = plan.unrealSets
        // The report is REBUILT from the lines the plan carries — this window
        // never saw those legs, and the one end-of-everything report has to
        // name them anyway. They ride as pre-formatted lines (their per-leg
        // timings are gone with the window that measured them) in `carried`,
        // NOT in `houdini`: that array's length is the count of finished
        // Houdini projects and drives the task cards, so folding these in
        // would mark the running project's card done on arrival.
        runReportRef.current = {
          carried: plan.reportLines,
          carriedFailed: plan.anyFailed,
          houdini: [],
        }
        pipelineRef.current = {
          daz: [],
          houdini: [plan.hipPath, ...plan.remaining].map((path) => ({
            path,
            label: stemOf(path),
            networks: plan.sceneScope.map(stemOf),
            sets: hipSetsRef.current[path],
          })),
          unreal: unrealTargetsFrom(plan.unrealProjects, plan.unrealSets),
        }
        // Arm the watch's own poll: `houdini` state drives the interval.
        setHoudini({ state: 'starting', startedAtMs: plan.startedAtMs })
        publishPipeline(progressRef.current, { state: 'starting', startedAtMs: plan.startedAtMs })
      })
      .catch(() => {
        // Read-only convenience — without it the leg simply stays invisible,
        // which is the behaviour this replaces.
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useRefetchOnFocus(
    () => {
      void refreshStatus()
    },
    [],
    { immediate: true },
  )
  const watching =
    pending === true || progress !== null || houdini !== null || unrealRun !== null
  useEffect(() => {
    if (!watching) return
    const id = window.setInterval(() => {
      void refreshStatus()
      // Cheap while nothing is armed: fetchHoudiniRunProgress returns null
      // immediately without touching the filesystem.
      void refreshHoudini()
      void refreshUnreal()
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
      void dismissExportRun()
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
    return (
      <HoudiniProgressButton
        houdini={houdini}
        queued={houdiniQueueRef.current?.projects.length ?? 0}
        onStopWatching={() => {
          // The one way out, mirroring the Daz leg's Ctrl+abort. The export
          // itself is NOT stopped — hython owns it and has no window to close
          // anymore — but the studio stops watching and drops the projects
          // still queued behind this one, which is the part the user is
          // actually asking to cancel.
          void dismissHoudiniRun()
          const dropped = houdiniQueueRef.current?.projects.length ?? 0
          houdiniQueueRef.current = null
          // The accumulated report belongs to a process that no longer ends
          // here — dropping it stops a later, unrelated run from firing it.
          runReportRef.current = null
          setHoudini(null)
          clearPipeline()
          toast.info(
            dropped > 0
              ? `Stopped watching the Houdini export — it keeps running in the background, and the ${dropped} queued project${dropped === 1 ? '' : 's'} will not start.`
              : 'Stopped watching the Houdini export — it keeps running in the background.',
          )
        }}
      />
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
          unrealProjects={unrealProjects}
          onClose={() => setOpen(false)}
          onExported={(run) => {
            // A new run supersedes the previous outcome (see dismissFinishToasts).
            dismissFinishToasts()
            runReportRef.current = null
            resetUnrealLeg()
            setPending(true)
            // The header's task cards: the run's selection in run order —
            // the Daz scenes, then the Houdini projects (rom-only continues
            // into nothing, so its houdini list is already empty here).
            dazLaunchedRef.current = run.dazLaunched
            // Held for the end of the WHOLE process; the Daz run record carries
            // a copy so a reload during the batch doesn't lose it.
            unrealTargetsRef.current = run.unrealProjects
            unrealSetsRef.current = run.unrealSets
            pipelineRef.current = {
              daz: run.scenes.map((path) => ({ path, label: stemOf(path) })),
              dazMode: run.mode,
              houdini: run.houdiniProjects.map((path) => ({
                path,
                label: stemOf(path),
                networks: run.houdiniScenes.map(stemOf),
                sets: hipSetsRef.current[path],
              })),
              unreal: unrealTargetsFrom(run.unrealProjects, run.unrealSets, run.unrealLocated),
            }
            publishPipeline(null, houdiniRef.current)
            // Arm the progress view right away (0/n until Daz delivers).
            void refreshStatus()
          }}
          // A skip-Daz run hands its selection straight to the Houdini queue —
          // the same machinery the after-batch continuation drives.
          onHoudiniQueue={(projects, scenes, unrealTargets, unrealSets, located) => {
            dismissFinishToasts()
            runReportRef.current = null
            resetUnrealLeg()
            pipelineRef.current = {
              daz: [],
              houdini: projects.map((path) => ({
                path,
                label: stemOf(path),
                networks: scenes.map(stemOf),
                sets: hipSetsRef.current[path],
              })),
              unreal: unrealTargetsFrom(unrealTargets, unrealSets, located),
            }
            unrealTargetsRef.current = unrealTargets
            unrealSetsRef.current = unrealSets
            void startHoudiniQueue(projects, scenes)
          }}
          // "Skip Houdini" with Daz skipped too: one file write, no watch —
          // the same thing the character page's Send panel does, reached from
          // the dialog the rest of the pipeline lives in.
          onUnrealOnly={(targets, sets, located) => {
            dismissFinishToasts()
            resetUnrealLeg()
            unrealTargetsRef.current = targets
            unrealSetsRef.current = sets
            // The run IS the send, so it gets the same task list as any other
            // leg: writing a file and showing nothing reads as "nothing
            // happened" — which is also exactly what a closed editor looks like.
            pipelineRef.current = {
              daz: [],
              houdini: [],
              unreal: unrealTargetsFrom(targets, sets, located),
            }
            publishPipeline(null, null)
            void sendToUnreal().then((lines) => {
              publishPipeline(null, null)
              if (lines.length > 0) {
                toast.info(lines.join('\n'), {
                  duration: Infinity,
                  description:
                    'The bridge imports it when that project is open in Unreal — open the editor if it is closed.',
                })
              }
            })
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
    // The same spelling the run's Daz task rows carry — one source, so the
    // card cannot end up calling the run something the dropdown didn't.
    title: EXPORT_MODE_LABELS['rom-export'],
    blurb: 'Build a fresh ROM, save the ROM animation scene, then export everything.',
  },
  {
    mode: 'rom-only',
    title: EXPORT_MODE_LABELS['rom-only'],
    blurb: 'Build the ROM and save the ROM animation scene, skipping the export.',
  },
  {
    mode: 'export-only',
    title: EXPORT_MODE_LABELS['export-only'],
    blurb: 'Export the saved ROM animations as they stand, without rebuilding.',
  },
  {
    mode: 'houdini-only',
    title: 'Skip Daz — use last exports',
    blurb: 'Run nothing in Daz; the Houdini projects work off each scene’s last export.',
  },
]

/** The Houdini **Mode** dropdown — what the Houdini leg does. `skip` is offered
 *  only when the project has a linked Unreal project (see
 *  {@link HoudiniRunMode}): without one it would mean "do nothing". */
const HOUDINI_MODE_OPTIONS: ReadonlyArray<{ mode: HoudiniRunMode; title: string; blurb: string }> = [
  {
    mode: 'export-selected',
    title: 'Export selected scenes',
    blurb: 'Run the DazToHue exports for the checked Daz scenes.',
  },
  {
    mode: 'skip',
    title: 'Skip Houdini — use last exports',
    blurb: 'Run no Houdini; hand the last exports on disk to the Unreal projects below.',
  },
]

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

/** One linked Unreal project in the dialog's third section. Same shape as
 *  {@link HipRow} — checkbox, logo, name, one line of context. */
function UnrealRow({
  uproject,
  checked,
  has,
  disabled,
  onToggle,
}: {
  uproject: string
  checked: boolean
  /** The project already holds this character (an asset named after one of its
   *  export sets) — why it comes pre-checked. null = the probe hasn't landed. */
  has: boolean | null
  /** This run produces no export, so there is nothing to send — the row goes
   *  inert rather than sitting there ticked and lying about what Start does. */
  disabled: boolean
  onToggle: () => void
}) {
  const stem = (uproject.split(/[\\/]/).pop() ?? uproject).replace(/\.[^./\\]+$/, '')
  const parts = uproject.replace(/\\/g, '/').split('/').filter(Boolean)
  const shortPath = parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : uproject.replace(/\\/g, '/')
  return (
    <div className="group/card relative w-full">
      <div
        className={`unreal-pick-card relative flex items-center gap-3 rounded-lg border p-3 pl-4${disabled ? ' opacity-50' : ''}`}
        data-selected={checked ? 'true' : undefined}
      >
        <input
          type="checkbox"
          className="relative z-10 size-4 shrink-0 accent-unreal-blue"
          aria-label={`Send to ${stem}`}
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
        />
        <span className="flex aspect-[3/4] h-[56px] shrink-0 items-center justify-center rounded-md bg-[#262626]">
          <img src={unrealLogo} alt="" aria-hidden className="size-8 object-contain" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{stem}</span>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={uproject.replace(/\\/g, '/')}>
            {has === true ? 'Already has this character' : shortPath}
          </p>
        </div>
      </div>
      {!disabled && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={onToggle}
          className="absolute inset-0 rounded-lg"
        />
      )}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg bg-unreal-blue" />
    </div>
  )
}

function DthExportDialog({
  projectId,
  character,
  unrealProjects,
  onClose,
  onExported,
  onHoudiniQueue,
  onUnrealOnly,
  onDazClosing,
}: {
  projectId: string
  character: Character
  /** The project's linked `.uproject`s — the run's third leg. */
  unrealProjects: ReadonlyArray<string>
  onClose: () => void
  /** A handoff was written — the header button flips to Abort. Carries the
   *  run's selection (run order) for the header's task cards; `houdiniProjects`
   *  is empty when the Houdini leg won't run exports (open-only, rom-only),
   *  `houdiniScenes` = the scene scope that leg will export (its networks). */
  onExported: (run: {
    scenes: Array<string>
    houdiniProjects: Array<string>
    houdiniScenes: Array<string>
    /** The Unreal projects the run finishes into ([] = none picked). */
    unrealProjects: Array<string>
    /** The export sets to hand over — the user's own tick list. */
    unrealSets: Array<string>
    /** Which of those sets each project ALREADY holds (the send plan's probe) —
     *  what lets the run's Unreal rows say "Re-import" instead of guessing. */
    unrealLocated: Record<string, Record<string, string>>
    /** What the batch does to each scene — the Daz rows' subtitle. */
    mode: ExportMode
    /** The handoff started Daz itself (vs. handing to a running one). */
    dazLaunched: boolean
  }) => void
  /** A skip-Daz run handed its selection straight to Houdini (no Daz batch) —
   *  the caller starts the sequential project queue on these scenes. */
  onHoudiniQueue: (
    projects: Array<string>,
    scenes: Array<string>,
    unrealProjects: Array<string>,
    unrealSets: Array<string>,
    unrealLocated: Record<string, Record<string, string>>,
  ) => void
  /** Neither Daz nor Houdini runs — the whole run is the Unreal send, off the
   *  exports already on disk. */
  onUnrealOnly: (
    unrealProjects: Array<string>,
    unrealSets: Array<string>,
    unrealLocated: Record<string, Record<string, string>>,
  ) => void
  /** The handoff went to a Daz that is still shutting down — the caller shows
   *  the wait-and-relaunch modal (see WaitForDazCloseModal). */
  onDazClosing: () => void
}) {
  // Rows render immediately from the linked scenes; the affected-detection
  // (one stat + signature per scene) fills in and pre-checks the changed ones.
  const [status, setStatus] = useState<Array<ExecuteSceneStatus> | null>(null)
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set())
  /**
   * The user has picked their own scenes, so stop re-seeding them.
   *
   * Each Daz mode has its own "outstanding work" rule, and switching mode used
   * to re-run it over the whole list — which quietly threw away a hand-made
   * selection: picking one scene and then switching to "Skip Daz" re-checked
   * every scene that has an export, and the Houdini list (which follows the
   * scenes) came with it. Seeding is a courtesy for a list nobody has touched;
   * after that it is the user's list.
   */
  const [scenesTouched, setScenesTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  // The Daz Mode dropdown. The ref mirrors it for the scene probe (kicked off
  // at mount), which seeds the pre-selection whenever it lands.
  const [mode, setMode] = useState<RunChoice>('rom-export')
  const modeRef = useRef<RunChoice>('rom-export')
  // The Houdini list's selection + its Mode dropdown. `export-selected` is the
  // default the moment a project joins the run; `skip` runs no Houdini at all
  // and is offered only when the project has a linked `.uproject` to send to.
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
  // Each linked scene's expected `.dth`, resolved in the api layer (it needs
  // the project's scenes root — see fetchSceneDthPaths). Keyed by
  // normalizeSceneKey, the same spelling the scene checkboxes carry.
  const [sceneDth, setSceneDth] = useState<Record<string, string>>({})
  // null = still checking (Start stays off for the moment the probe takes).
  const [runner, setRunner] = useState<RunnerGate | null>(null)
  // The Unreal list's selection, and which projects already hold this
  // character (the pre-selection, the Unreal twin of "changed since the last
  // export" and "imports a selected scene").
  const [checkedUnreal, setCheckedUnreal] = useState<ReadonlySet<string>>(new Set())
  // The character's export sets + which of them each linked project holds.
  // null = the probe hasn't landed.
  const [sendPlan, setSendPlan] = useState<UnrealSendPlan | null>(null)
  const [checkedSets, setCheckedSets] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    if (unrealProjects.length === 0) return
    let active = true
    void fetchUnrealSendPlan({ data: { projectId, id: character.id } })
      .then((plan) => {
        if (active) setSendPlan(plan)
      })
      .catch(() => {
        // Detection is a convenience: with none, the rows simply start
        // unchecked and the user picks.
        if (active) setSendPlan({ sets: [], located: {} })
      })
    return () => {
      active = false
    }
    // Mount-only, like the other probes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    void Promise.all([
      fetchCachedHoudiniScans({ data: { projectId, id: character.id } }),
      fetchSceneDthPaths({ data: { projectId, id: character.id } }),
    ])
      .then(([scans, dthPaths]) => {
        if (!active) return
        setSceneDth(dthPaths)
        setHipImports(
          scans.map((scan) => ({
            hipPath: scan.hipPath,
            imports: scan.imports,
            // The sets this project WRITES — what the Unreal pre-selection
            // asks about. Dropping it here is what made every run read as
            // "cannot tell" no matter how fresh the scan was.
            exportSets: scan.exportSets,
          })),
        )
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
   *  "Skip Houdini", which runs no export and therefore consumes none: it
   *  hands over what is already in the character's export folder. */
  const noExportChecked =
    houdiniMode === 'skip' ? [] : scenesMissingExport(mode, status, checked)
  // The probe (one stat per scene) is sub-second; holding Start for it closes
  // the window where a row checked mid-flight could start with unknown state.
  // Both artifact-gated modes wait it out the same way.
  const checking = (mode === 'export-only' || mode === 'houdini-only') && status === null
  /**
   * Whether this run has something to hand over: a Houdini project that
   * EXPORTS, or the deliberate `skip` that sends the exports already on disk.
   *
   * **ROM only is excluded even though it forces `skip`.** That mode stops
   * before Houdini, so its send could only hand over the PREVIOUS export while
   * the run reads as "the new ROM reached Unreal" — the misleading success this
   * studio exists to avoid, and the same reasoning that makes `executeJobs`
   * refuse a rom-only run with Houdini projects attached. `skip` is a CHOICE
   * ("use last exports") when the user picks it; under rom-only it is merely
   * what `pickMode` was left with, and inheriting a send from it would be a
   * choice nobody made.
   */
  const unrealSendable = mode !== 'rom-only' && (houdiniMode === 'skip' || checkedHips.size > 0)

  /**
   * A ticked Unreal project with NO ticked export set — the one combination
   * that looks armed and hands over nothing.
   *
   * `onExport` drops the projects when no set is ticked (a set list is what a
   * job carries), so this state used to start a run whose Unreal leg silently
   * did not exist — and in the send-only run, pressing Start did literally
   * nothing at all: no send, no rows, no message, dialog closed. It is also the
   * DEFAULT state of the flow the feature is for: a FIRST import pre-ticks no
   * set, by design, so the user must tick one. Refusing with a reason beats a
   * button that lies.
   */
  const unrealIncomplete = unrealSendable && checkedUnreal.size > 0 && checkedSets.size === 0

  /**
   * The export sets THIS RUN will produce, or null when the studio cannot say.
   *
   * Each checked Houdini project declares the sets it writes (its export
   * nodes' `character_name`, read in the project scan). A project the scan has
   * never reached declares nothing — and "not known" is not "writes nothing",
   * so one unscanned project makes the whole answer null.
   *
   * **Null pre-ticks NOTHING**, rather than falling back to "does this project
   * hold this character at all". That fallback is what the report was about:
   * picking the THICK project ticked an Unreal project because it held a
   * DIFFERENT variant, and the run then imported one nobody asked for. An
   * un-ticked row the user can tick costs a click; a ticked one they did not
   * mean costs a stray character in their project.
   *
   * Under `skip` the run produces nothing new: the sets in play are whatever is
   * on disk, so the question does not arise and presence alone decides.
   */
  const runSets =
    houdiniMode === 'skip'
      ? null
      : (() => {
          const chosen = character.houdiniProjects.filter((hip) => checkedHips.has(hip))
          if (chosen.length === 0) return null
          const known = chosen.map((hip) => hipImports.find((scan) => scan.hipPath === hip))
          if (known.some((scan) => scan === undefined || scan.exportSets === undefined)) return null
          return new Set(known.flatMap((scan) => scan?.exportSets ?? []))
        })()


  /**
   * The Unreal selection FOLLOWS the Houdini one, the same way the Houdini list
   * follows the Daz scenes: untick the projects that would export and the send
   * has nothing to hand over, so it leaves the run with them — and comes back
   * when they do. Also the reason the probe above only sets `unrealHas`: it
   * lands after this has run at least once, and a selection seeded there would
   * survive a run that can no longer send.
   *
   * A hand-picked selection is reset by that round trip, exactly as a
   * hand-picked Houdini project is when its scene goes and returns. The default
   * IS the answer to "which projects is this export for".
   */
  useEffect(() => {
    if (!unrealSendable || sendPlan === null) {
      setCheckedUnreal(EMPTY_SELECTION)
      return
    }
    setCheckedUnreal(
      runSets === null && houdiniMode !== 'skip'
        ? EMPTY_SELECTION
        : new Set(
            unrealProjects.filter((path) =>
              Object.keys(sendPlan.located[path] ?? {}).some(
                (name) => runSets === null || runSets.has(name),
              ),
            ),
          ),
    )
    // `unrealProjects` is the prop array, stable per render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `runSets` is derived from the state this effect already depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unrealSendable, sendPlan, houdiniMode, checkedHips, hipImports])

  /**
   * WHICH export sets go. Ticked = the set is already in one of the ticked
   * projects (a re-import); a set no ticked project has is a FIRST import and
   * waits to be asked for — measured the hard way, when a send imported an
   * outfit variant its owner had never put in that project.
   *
   * And only sets THIS RUN produces: picking the THICK scene and its project
   * pre-ticked a set the run was never going to touch — and the Unreal project
   * with it — because "has this character" is not "has what this run makes".
   */
  useEffect(() => {
    if (!unrealSendable || sendPlan === null) {
      setCheckedSets(EMPTY_SELECTION)
      return
    }
    if (runSets === null && houdiniMode !== 'skip') {
      setCheckedSets(EMPTY_SELECTION)
      return
    }
    setCheckedSets(
      new Set(
        sendPlan.sets
          .filter((name) => runSets === null || runSets.has(name))
          .filter((name) =>
            [...checkedUnreal].some((path) => sendPlan.located[path]?.[name] !== undefined),
          ),
      ),
    )
    // `runSets` is derived from the state this effect already depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unrealSendable, sendPlan, checkedUnreal, houdiniMode, checkedHips, hipImports])

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
        // run writes no fresh export, so a Houdini continuation could only
        // re-consume the PREVIOUS one while the report reads as the new ROM's
        // round trip (`executeCharacterJobs` refuses that combination outright).
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
  // — the key 456.py matches on at export time — so ticking a scene off takes
  // its project with it. Runs on every change of the scene selection (whatever
  // changed it: a toggle, Solo, All, a mode re-seed), and again when the stored
  // scans land. A project is only DROPPED on a positive match against a
  // deselected scene, which is why the unticked scenes' `.dth` paths are handed
  // over too (see `hipsForSelectedScenes` — nothing is ever dropped on
  // ignorance). Missing `.hip`s stay out. Not under rom-only — that list is a
  // manual OPEN pick.
  useEffect(() => {
    if (mode === 'rom-only' || hipImports.length === 0) return
    const dthFor = (scene: string): string => sceneDth[normalizeSceneKey(scene)] ?? ''
    const scenesDth = [...checked].map(dthFor).filter((dth) => dth !== '')
    // The other side of the same coin: every LINKED scene that is not ticked.
    // Read off the scene list rather than "everything in sceneDth minus the
    // selection", so a scene the resolver could not place is simply absent from
    // both sets — unknown, not deselected.
    const deselectedDth = [character.scenePath, ...character.extraScenes]
      .filter((scene) => scene && !checked.has(scene))
      .map(dthFor)
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
      const next = hipsForSelectedScenes(judged, scenesDth, prev, deselectedDth)
      for (const hip of hipMissing) next.delete(hip)
      // Same members → same object, so the Houdini list doesn't re-render on
      // every unrelated poll (and the Unreal effects, which key on this set,
      // don't re-seed a selection the user has since made their own).
      if (next.size === prev.size && [...next].every((hip) => prev.has(hip))) return prev
      return next
    })
  }, [checked, hipImports, hipMissing, mode, character, sceneDth])

  function toggle(scene: string) {
    setScenesTouched(true)
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
    // Only seed a list the user has not made their own — see `scenesTouched`.
    if (status && !scenesTouched) setChecked(preCheckedScenes(next, status))
    // ROM only writes no fresh export, so a Houdini continuation has nothing
    // of THIS run's to consume — whatever the list had armed (auto-selection
    // included) doesn't carry over, and the one thing it can still do is OPEN
    // a project the user re-picks deliberately.
    if (next === 'rom-only') {
      setCheckedHips(new Set())
      setHoudiniMode('skip')
    }
  }

  /** The Houdini list's toggle — a plain multi-select now that both
   *  single-project modes are gone: every remaining mode runs any number of
   *  projects, so there is no combination to steer the user out of. */
  function toggleHip(hip: string) {
    const next = new Set(checkedHips)
    if (next.has(hip)) next.delete(hip)
    else next.add(hip)
    setCheckedHips(next)
  }

  async function onExport() {
    setBusy(true)
    try {
      const chosenScenes = rows.filter((r) => checked.has(r.scenePath)).map((r) => r.scenePath)
      const chosenHips = character.houdiniProjects.filter((hip) => checkedHips.has(hip))
      // Only when this run actually exports — see `unrealSendable`.
      const chosenUnreal = unrealSendable
        ? unrealProjects.filter((path) => checkedUnreal.has(path))
        : []
      // No set ticked = nothing to send, whatever is ticked above it.
      const chosenSets = [...checkedSets]
      const unrealTargets = chosenSets.length > 0 ? chosenUnreal : []
      // The probe behind the pre-selection, handed up so the run's Unreal rows
      // can say re-import vs first import per project ({@link UnrealSendPlan}).
      const located = sendPlan?.located ?? {}
      // Skip Daz: the Houdini selection IS the run — the same machinery the
      // after-batch continuation drives, minus the batch.
      if (mode === 'houdini-only') {
        // Nothing to run in Daz OR Houdini: this IS the "just re-import in
        // Unreal" case, and it is one file write away.
        if (houdiniMode === 'skip') {
          onUnrealOnly(unrealTargets, chosenSets, located)
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
        onHoudiniQueue(chosenHips, chosenScenes, unrealTargets, chosenSets, located)
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
          // Skipping means no Houdini leg: the record must not name one, or
          // a reloaded window would restore a continuation nobody asked for.
          houdiniProjects: houdiniMode === 'skip' ? [] : chosenHips,
          houdiniMode,
          unrealProjects: unrealTargets,
          unrealSets: chosenSets,
        },
      })
      onExported({
        scenes: chosenScenes,
        houdiniProjects: mode === 'rom-only' || houdiniMode === 'skip' ? [] : chosenHips,
        // The scene scope the Houdini leg will export (→ the networks its
        // task cards name) — the continuation recomputes the same set.
        houdiniScenes: chosenScenes,
        unrealProjects: unrealTargets,
        unrealSets: chosenSets,
        unrealLocated: located,
        mode,
        // Whether the handoff STARTED Daz — the status line's opening word
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
              onSolo={() => {
                setScenesTouched(true)
                setChecked(new Set([row.scenePath]))
              }}
              onSelectAll={() => {
                setScenesTouched(true)
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
              }}
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
              // scene, when the whole run has nothing to start from. NOT when
              // the project has a linked Unreal project: `skip` is precisely
              // the choice for a run with no Houdini in it, so requiring a
              // ticked Houdini project to reach it locks the user out of the
              // one mode that says "don't run Houdini".
              disabled={
                unrealProjects.length === 0 && (checkedHips.size === 0 || checked.size === 0)
              }
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
                    // The EXPORT mode is dead under ROM only: that run writes
                    // no fresh export, so it could only re-consume the previous
                    // one while reading as this run's output.
                    // `skip` needs somewhere to send to; the export mode needs
                    // a run that produces an export.
                    disabled={
                      option.mode === 'skip'
                        ? unrealProjects.length === 0
                        : mode === 'rom-only'
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
      {/* The third leg. Only when the run can actually produce an export —
          a send needs something exported, and the Houdini list is what
          produces it. */}
      {unrealProjects.length > 0 && character.houdiniProjects.length > 0 && (
        <div>
          <Label className="mb-1.5">Unreal projects</Label>
          <div className="space-y-2">
            {unrealProjects.map((uproject) => (
              <UnrealRow
                key={uproject}
                uproject={uproject}
                checked={checkedUnreal.has(uproject)}
                has={
                  sendPlan === null
                    ? null
                    : Object.keys(sendPlan.located[uproject] ?? {}).length > 0
                }
                disabled={!unrealSendable}
                onToggle={() =>
                  setCheckedUnreal((current) => {
                    const next = new Set(current)
                    if (next.has(uproject)) next.delete(uproject)
                    else next.add(uproject)
                    return next
                  })
                }
              />
            ))}
          </div>
          {unrealSendable && sendPlan !== null && sendPlan.sets.length > 0 && (
            <ul className="mt-2 space-y-1">
              {sendPlan.sets.map((name) => {
                // Where it would land: in the first TICKED project that has it,
                // or — when nothing is ticked yet — in any linked project that
                // does. Reading only the ticked ones made every row say "not in
                // this project" the moment the pre-selection ticked nothing,
                // which is exactly when the user needs the truth to decide.
                const lookIn = checkedUnreal.size > 0 ? [...checkedUnreal] : unrealProjects
                const at = lookIn
                  .map((path) => sendPlan.located[path]?.[name])
                  .find((found) => found !== undefined)
                return (
                  <li key={name}>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-unreal-blue"
                        checked={checkedSets.has(name)}
                        onChange={(e) =>
                          setCheckedSets((current) => {
                            const next = new Set(current)
                            if (e.target.checked) next.add(name)
                            else next.delete(name)
                            return next
                          })
                        }
                      />
                      <span className="font-mono">{name}</span>
                      {at !== undefined ? (
                        <span className="text-xs text-muted-foreground">{at}</span>
                      ) : (
                        <span className="rounded bg-amber-500/15 px-1 py-0.5 text-xs font-medium text-amber-500">
                          not in this project
                        </span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
          {unrealSendable && runSets === null && houdiniMode !== 'skip' && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-500">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Nothing pre-selected: the studio doesn&apos;t know yet which export set these
                Houdini projects write. <strong>Rescan</strong> them (Utils drawer) and it will
                tick what this run actually refreshes.
              </span>
            </p>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">
            {!unrealSendable
              ? mode === 'rom-only'
                ? // Naming the Houdini pick here would be advice the user cannot
                  //  take: rom-only cleared that list and runs no Houdini at all.
                  'ROM only writes no export — nothing to send. Run “ROM + Export”, or send the last export with “Skip Daz”.'
                : 'Needs somewhere to send from: tick a Houdini project, or pick “Skip Houdini”.'
              : sendPlan !== null && sendPlan.sets.length === 0
                ? 'Nothing exported yet — this run’s own export can be sent from the character page afterwards.'
                : 'Queued for import when the whole export finishes — the editor picks it up when it is next open.'}
          </p>
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
            // A ticked project with no ticked set sends nothing — true of every
            // mode, so it gates them all rather than only the send-only run.
            unrealIncomplete ||
            (mode === 'houdini-only' && houdiniMode === 'skip'
              ? // Neither app runs: the whole run is the send, so the Unreal
                // pick is the only thing that can gate it.
                checkedUnreal.size === 0
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
                : unrealIncomplete
                  ? // Before the mode-specific wording: this one is about the
                    //  Unreal list whatever the rest of the run is doing.
                    'Tick an export set to send, or untick the Unreal project'
                  : mode === 'houdini-only' && houdiniMode === 'skip'
                  ? // The send-only run's single requirement — the Daz-scene
                    // wording below would name a selection it never reads.
                    checkedUnreal.size === 0
                    ? 'Select the Unreal project to send to'
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
