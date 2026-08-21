import { useEffect, useRef, useState } from 'react'
import { Ban } from 'lucide-react'
import { toast } from 'sonner'

import { Button, useArmedWatch, useCoalescedRefresh, useRefetchOnFocus } from '@dth/ui'
import {
  abortExporterJobs,
  adoptHoudiniRun,
  adoptUnrealImports,
  awaitBatchPickup,
  exporterJobsPending,
  fetchExportRunProgress,
  dismissUnrealImport,
  fetchCachedHoudiniScans,
  fetchUnrealImportProgress,
  fetchHoudiniRunProgress,
  interruptExportRun,
  verifyDazExportsLanded,
  openUnrealForPendingJob,
  startHoudiniExport,
  startUnrealImport,
  watchExportRunFiles,
} from '#/lib/rom/api.ts'
import { holdBusyCursor } from '#/lib/busy-cursor.ts'
import {
  dazTaskCards,
  houdiniNetworkMemoAtFinish,
  houdiniTaskCards,
  type HoudiniNetworkMemo,
  runPercent,
  unrealTaskCards,
} from '#/lib/rom/export-cards.ts'
import {
  formatElapsed,
  normalizeSceneKey,
  scenesRetiredByRun,
  scriptFailureLines,
  tidyRunErrors,
} from '#/lib/rom/execute-jobs.ts'

import type { ExportRunProgress } from '#/lib/rom/api.ts'
import type { UnrealTarget } from '#/lib/rom/export-cards.ts'
import type {
  ExportPipelineView,
  ExportTask,
  ExportTaskKind,
} from '#/components/character/export-pipeline-panel.tsx'
import { HOUDINI_CONSOLE_FILE } from '#/lib/rom/houdini-jobs.ts'
import type { HoudiniRunState } from '#/lib/rom/houdini-jobs.ts'
import type { UnrealImportState } from '#/lib/rom/unreal-jobs.ts'
import type { ExportMode } from '#/lib/rom/execute-jobs.ts'
import type { Character } from '@dth/rom'

import {
  DthLogo,
  EXPORT_TOAST_ID,
  ExportProgressButton,
  exportFinishToast,
  HOUDINI_TOAST_ID,
  HoudiniProgressButton,
  NO_UNREAL_PROJECTS,
  capitalizeStatus,
  dismissFinishToasts,
  exportWarningToast,
  unrealOutcomeToast,
} from './dth-export/progress.tsx'
import { WaitForDazCloseModal } from './dth-export/rows.tsx'
import { DthExportPanel } from './dth-export/panel.tsx'

/**
 * The header's **DTH Export** button + its scene-picker panel: choose which
 * linked Daz scenes to run through the DTH Exporter Plugin, then hand them off
 * as a job file and start Daz Studio (api/execute.ts +
 * docs/exporter-plugin-job-file.md).
 *
 * The picker is a **side panel** (`SidePanel`, the app’s drawer — same shell as
 * the Houdini project utils), not the centered modal it used to be: the run has
 * three stacked legs (Daz scenes, Houdini projects, Unreal projects), and at
 * `max-w-xl`/`85vh` the third one lived below the fold behind a scroll. The
 * drawer gives the lists their full height, with Start pinned to its bottom
 * edge so the action never scrolls away.
 *
 * The panel lists every linked scene as a simplified Daz scene card (accent
 * bar + selected styling like the editor's scene cards) with a checkbox; the
 * AFFECTED scenes — changed `.duf` or definition since their last handoff —
 * come pre-checked. Each row's wand solos it (check only this one). Confirm
 * needs at least one checked scene.
 *
 * Disabled while the draft is dirty (the export runs the GENERATED scripts on
 * disk, which lag unsaved edits), without an export directory (the runs exist
 * to deliver exports), or without a configured Daz library. Inside the panel,
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
 * toasts a failure instead. The working button IS the interrupt ({@link
 * WorkingButton}, both legs): hovering swaps its spinner for a stop mark and
 * a click drops the studio's interrupt flag, which the generated Daz scripts,
 * the DTH runtime and 456.py all poll, so the run stops at its next safe
 * point and is reported as interrupted. Status refreshes on window focus and
 * polls lightly while pending/running.
 *
 * History: both legs used to hide a modifier-revealed escape hatch here —
 * **Ctrl** turned the Daz button into **Abort** (delete the claimed job file)
 * and the Houdini button into **Stop watching** (drop the watch + the project
 * queue). Both stopped the STUDIO, never the run, because stopping the run was
 * impossible; both are gone now that it isn't. Clearing a job file nothing will
 * ever finish stays available where housekeeping belongs — Settings → App Data.
 */

/**
 * Marks a WARNING among the plain strings of a run sidecar's `reportLines` —
 * the only channel a reloaded window inherits earlier legs through. A finished
 * leg's warnings ride there as `⚠ <project>: <complaint>` so the adopting
 * window can put them back into warning toasts instead of folding an amber
 * fact into its summary body. An older build reading a newer sidecar renders
 * the line verbatim, prefix and all — legible, just unsplit.
 */
const CARRIED_WARNING_PREFIX = '⚠ '

/**
 * A carried warning's `<project>: <complaint>` body — without saying one name
 * twice. `run.problems` entries already lead with the node's scene (or its
 * path — see `houdiniRunStateFrom`), and a single-scene project usually names
 * scene and `.hip` alike, so blindly prefixing the project produced
 * `Kira: Kira: No bone scale reference found` (measured in the leg-reload
 * smoke). The project prefix is only added when it says something new.
 */
function labelledWarning(label: string, problem: string): string {
  return problem.startsWith(`${label}: `) ? problem : `${label}: ${problem}`
}

export function DthExportAction({
  projectId,
  character,
  saving,
  dirty,
  dazLibraryConfigured,
  unrealProjects = NO_UNREAL_PROJECTS,
  onPipeline,
  onRunStarted,
}: {
  projectId: string
  character: Character
  saving: boolean
  dirty: boolean
  /** “My DAZ 3D Library” is set — where the job file and scripts live. */
  dazLibraryConfigured: boolean
  /** The PROJECT's linked `.uproject`s (per-project, not per-character) — the
   *  panel's third leg. Empty = no Unreal section at all. */
  unrealProjects?: ReadonlyArray<string>
  /** The run's live pipeline view (task cards + the tail-mode log), reported
   *  up so the header can render {@link ExportPipelinePanel} ABOVE the whole
   *  button cluster (this component only owns its own buttons). Null = no run. */
  onPipeline?: (view: ExportPipelineView | null) => void
  /** A handoff just went out — the page drops the PREVIOUS run's findings for
   *  the scenes it retires (the red banner + the red morph rows), which the
   *  handoff has already retired on disk. Which scenes those are is
   *  {@link scenesRetiredByRun}: the ones the run re-runs, and none at all for
   *  an export-only run, which rebuilds no ROM. */
  onRunStarted?: (scenePaths: ReadonlyArray<string>) => void
}) {
  const [open, setOpen] = useState(false)
  // null = not yet checked (renders as the normal export button).
  const [pending, setPending] = useState<boolean | null>(null)
  const [progress, setProgress] = useState<Extract<ExportRunProgress, { state: 'running' }> | null>(
    null,
  )
  const [aborting, setAborting] = useState(false)
  // The interrupt has been requested from THIS window. The api layer carries
  // the same fact on the run itself (so a reloaded window still shows it) —
  // this is the immediate half, because the flag lands on disk long before the
  // next 2.5 s poll reports it back.
  const [interrupting, setInterrupting] = useState(false)
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
     *  adopted: the job file it reads never carried the panel's choice. */
    dazMode?: ExportMode
    /** `networks` = the scene stems the project will export (the DazToHue
     *  networks are matched per scene). NOTHING RENDERS IT: `houdiniTaskCards`
     *  names its rows from the run's own network list, that project's last
     *  snapshot, or the stored scan's `sets` — never from here. Kept as the
     *  record of what each project's scope WAS (and so of what the landed
     *  guard narrowed it to), not as display data; don't add a caller without
     *  first checking whether `sets` is the field you actually want. */
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
   * `located` is the panel's probe (which project already holds which set),
   * which is what turns a row into "Re-import" — and what DROPS a set the
   * project has never held, because the send is re-import only
   * (`unrealTaskCards` filters `existing === false`). It is absent for a run
   * RESTORED after a reload — the plan carries the set names, not the probe —
   * and those rows then say a plain "Import" rather than claiming either way
   * on no evidence. The send fills it in for real ({@link sendToUnreal}).
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
          // NOT `dazOpeningLine`: this batch has been CLAIMED (the rename is
          // the claim), so "waiting for Daz Studio to pick the batch up" is
          // simply false here — it read that way for every second between the
          // claim and the Runner's first progress line, which on a cold scene
          // open is a long time to be told nothing is happening.
          status: capitalizeStatus(step?.message || 'Daz Studio is working on the batch'),
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
      ...armed.houdini.flatMap((hip, index) => {
        const running =
          hip.label === houdiniActive && houdiniNow?.state === 'running' ? houdiniNow : null
        // Remember what the run says while it is saying it — this is the only
        // moment the network list exists, and the rows need it after.
        if (running && running.total > 0) {
          hipNetworkMemoRef.current[hip.path] = {
            total: running.total,
            networks: running.networks,
          }
        }
        return houdiniTaskCards(
          hip,
          index,
          running,
          hip.label === houdiniActive && houdiniNow !== null,
          houdiniDone,
          // Only a project that finished THIS run may render from its memo.
          // The ref outlives the run (that is its purpose — the rows must
          // survive the queue moving on), so on a RE-run the previous run's
          // snapshot is still in there: unguarded, it rendered the first
          // project as already ticked while hython was still opening
          // (measured 2026-08-19, a Skip-Daz re-run of the same character).
          // `houdiniDone` counts this run's finished projects in queue order,
          // so it is exactly the boundary between "these rows are this run's
          // past" and "that snapshot is some other run's".
          index < houdiniDone ? hipNetworkMemoRef.current[hip.path] : undefined,
        )
      }),
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
    // The button pair is gone with the run; a fresh one starts un-interrupted.
    setInterrupting(false)
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
    /** `warnings` are the HDA pre-flight complaints 456.py answered "Continue
     *  anyway?" to — WARNING toasts of their own at the end, never lines in
     *  the report body: "the export worked" and "this network has problems"
     *  are different messages in different states, and one toast wearing a
     *  green checkmark over both was read as neither. */
    houdini: Array<{
      line: string
      failed: boolean
      elapsedMs?: number
      label?: string
      warnings?: Array<string>
    }>
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
   * The Unreal projects this run finishes into — the panel's third leg.
   *
   * A ref for the same reason as the queue: the poll interval's closure is
   * armed once. It rides the Houdini run plan too, so a window that reloads
   * mid-export still sends when the queue drains.
   */
  const unrealTargetsRef = useRef<Array<string>>([])
  /** WHICH export sets the send hands over — the sets THIS RUN puts in play
   *  (see the panel's `sendSets`). Empty means the studio could not name them,
   *  and the send then hands over every set in the character's export folder;
   *  the targets list is what decides whether anything is sent at all. */
  const unrealSetsRef = useRef<Array<string>>([])
  /**
   * Each linked project's export-set names, from the STORED scan — the only
   * thing that can name a project's networks before hython has opened it.
   * Reported as "there should be two" while the log still said "Opening
   * Houdini": the run knows, minutes later, and the scan knew all along.
   */
  const hipSetsRef = useRef<Record<string, Array<string>>>({})
  /**
   * What each project's own run said about its networks, kept past the end of
   * that project's turn — keyed by `.hip` path.
   *
   * `houdiniNow` only ever describes the ACTIVE project, and the end report
   * keeps a summary line per project rather than its network list, so a
   * finished project had nothing to build rows from and fell back to a single
   * project row. The rows went 1 → N → 1: a two-project run that really
   * exported four networks showed two rows for the whole thing.
   */
  const hipNetworkMemoRef = useRef<Record<string, HoudiniNetworkMemo>>({})
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

  /** One send line, typed by what happened so the toast layer never has to
   *  sniff its own strings: `queued` = clean, `skipped` = queued but with
   *  sets dropped, `refused` = nothing queued. The `line` rides the final
   *  report as text; which kinds TOAST is {@link emitUnrealSendToasts}'s
   *  decision. */
  interface UnrealSendLine {
    kind: 'queued' | 'skipped' | 'refused'
    line: string
  }

  /**
   * Hand what the run just exported to the selected Unreal projects, and say so
   * in the end report.
   *
   * Runs when the WHOLE Houdini queue has drained: one job file per Unreal
   * project, each naming the export sets this run put in play (or every set in
   * the export folder, when the studio could not name them). Nothing is
   * watched afterwards — the send is a file write, and the editor picks it up
   * whenever it is next open (the character page's panel is where a live
   * import is followed).
   */
  async function sendToUnreal(): Promise<Array<UnrealSendLine>> {
    const targets = unrealTargetsRef.current
    unrealTargetsRef.current = []
    if (targets.length === 0) return []
    unrealSentRef.current = true
    const lines = await Promise.all(
      targets.map(async (uprojectPath): Promise<UnrealSendLine> => {
        const name = stemOf(uprojectPath)
        try {
          const started = await startUnrealImport({
            data: { projectId, id: character.id, uprojectPath, sets: unrealSetsRef.current },
          })
          const sets = started.sets.map((set) => set.name).join(', ')
          // The send is the moment the studio KNOWS which of these sets that
          // project already holds — it located them itself to write the job's
          // destinations. So the rows stop guessing: what the send kept is a
          // re-import for real, and a set the project has never held DROPPED
          // out of the run there (the send is re-import only), so its row
          // goes with it rather than sitting forever "waiting".
          const armed = pipelineRef.current
          const target = armed?.unreal.find((one) => one.path === uprojectPath)
          if (target) {
            target.sets = started.sets.map((set) => ({ name: set.name, existing: set.existing }))
          }
          // Nothing claims a job when nothing that could claim it is open — so
          // open the project. Five seconds is the bridge's poll (1s) with room
          // for a slow start; the api decides from what the running editors'
          // command lines say they have open, and answers WHY when it doesn't
          // launch — a job that quietly waits forever is exactly the failure
          // this leg had (reported 2026-08-20: a different project was open,
          // nothing launched, nothing said which).
          window.setTimeout(() => {
            void openUnrealForPendingJob({ data: { uprojectPath } })
              .then((outcome) => {
                // The status line says what is actually happening — an editor
                // takes a while to come up, and "waiting for the editor to
                // pick the job up" over a splash screen reads as stuck.
                if (outcome === 'no-job' || unrealWatchRef.current !== uprojectPath) return
                unrealStatusRef.current =
                  outcome === 'opened'
                    ? `Unreal; opening ${name} — the import starts on its own once the editor is up`
                    : outcome === 'opened-beside'
                      ? `Unreal; opening ${name} next to the Unreal editor already running — the import starts once it is up`
                      : outcome === 'target-open'
                        ? // Open and not claiming after the grace period: the
                          // likeliest cause is a Runner installed after the
                          // editor started (Unreal loads plugins at startup).
                          `Unreal; ${name} is open but hasn't picked the job up — if the Runner was just installed, restart the editor`
                        : `Unreal; an editor is running and the studio can't tell which project — if it isn't ${name}, open that project to start the import`
                publishPipeline(progressRef.current, houdiniRef.current)
              })
              .catch(() => {
                // queued either way — a failed launch is not a failed send
              })
          }, 5000)
          // The status line gets the same news the report will, as it happens.
          unrealStatusRef.current = `Unreal; queued for ${name} — waiting for the editor to pick the job up`
          // One project is watched — the handoff is one job at a time, and the
          // rows name the rest.
          if (!unrealWatchRef.current) unrealWatchRef.current = uprojectPath
          setUnrealState({ state: 'waiting' })
          // A skipped set is said, never swallowed: the run would otherwise
          // read as "everything reached Unreal" about a set that was dropped
          // because that project has never held it (re-import only).
          return started.skipped.length > 0
            ? {
                kind: 'skipped',
                // The report line carries both halves; the sentence break keeps
                // the skip from reading as a clause about the QUEUED sets.
                line: `Unreal: queued for ${name} — ${sets}. Not sent (never imported there): ${started.skipped.join(', ')} — make the first import in Unreal itself.`,
              }
            : { kind: 'queued', line: `Unreal: queued for ${name} — ${sets}` }
        } catch (error) {
          // A refusal here (no bridge, no export) must not read as an export
          // failure: the Houdini leg is done and its output is on disk. But it
          // must land in this target's ROWS — they were published as pending
          // work, and with no job ever written nothing else advances them, so
          // they spun "active" at 0% forever (measured 2026-08-19, against a
          // bridge a `p4 clean` had deleted).
          const armed = pipelineRef.current
          const target = armed?.unreal.find((one) => one.path === uprojectPath)
          if (target) target.failed = true
          unrealStatusRef.current = `Unreal; not queued for ${name}`
          return {
            kind: 'refused',
            line: `Unreal: not queued for ${name} — ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      }),
    )
    return lines
  }

  /**
   * Toasts for the send — and ONLY a refusal speaks. Queuing is mid-run news
   * the task rows + status line already carry ("a toast repeating the
   * progress bar", reported 2026-08-19); the leg's real report is
   * {@link unrealOutcomeToast}, when the editor answers. A refusal is an
   * ERROR: it used to ride a blue (i) over a still-spinning row, reading as
   * a shrug.
   *
   * A `skipped` entry toasts NOTHING here, deliberately. Both callers are
   * "use last exports" sends, whose whole promise — stated on the panel row
   * ("Already has what this run sends") — is refreshing what that project
   * already holds; the export folder holding MORE than that is the steady
   * state, not a drop from the promise, and warning about it fired on every
   * repeat send about variants the user keeps out of that project on purpose
   * (reported twice, 2026-08-19: "again…"/"we don't need that toast"). The
   * run's scope stays visible — only what goes gets a task row — and a set a
   * real EXPORT run produced that then didn't land still rides the final
   * report, which is the case where the drop is genuine news.
   */
  function emitUnrealSendToasts(lines: Array<UnrealSendLine>) {
    for (const { kind, line } of lines) {
      if (kind === 'refused') toast.error(line, { duration: Infinity })
    }
  }

  /** This run was interrupted — the fact the END-OF-RUN report needs, kept
   *  outside `runReportRef` because a Daz-only run reports without ever
   *  building one. Cleared when a new run is armed, never mid-run. */
  const interruptedRef = useRef(false)

  /**
   * Ask the run to stop at its next safe point — the whole run, both legs (the
   * flag is per character and every runtime the studio owns probes it).
   *
   * Order matters: nothing is dropped until the flag is actually on disk. The
   * QUEUE is the one part the studio can stop outright — those projects have
   * not started, so they simply never do — and dropping it before a failed
   * write would cancel work while telling the user the interrupt failed.
   */
  async function onInterrupt() {
    setInterrupting(true)
    try {
      await interruptExportRun({ data: { projectId, id: character.id } })
    } catch (error) {
      setInterrupting(false)
      toast.error(
        `Couldn't interrupt the export: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }
    const droppedHips = houdiniQueueRef.current?.projects.length ?? 0
    houdiniQueueRef.current = null
    // The third leg goes with them. It fires when the Houdini queue drains,
    // off whatever is on disk by then — which after an interrupt is a
    // half-finished export. Sending that to Unreal would hand the user a
    // partial import as if it were the run they asked for.
    const droppedSends = unrealTargetsRef.current.length
    unrealTargetsRef.current = []
    interruptedRef.current = true
    // Name everything that will now NOT happen — the parts the studio drops
    // outright are exactly the parts the user cannot see for themselves.
    const dropped = [
      droppedHips > 0
        ? `${droppedHips} queued Houdini project${droppedHips === 1 ? '' : 's'}`
        : '',
      droppedSends > 0 ? `the send to ${droppedSends} Unreal project${droppedSends === 1 ? '' : 's'}` : '',
    ].filter(Boolean)
    toast.info(
      dropped.length > 0
        ? `Stopping the export at the next safe point — ${dropped.join(' and ')} will not start.`
        : 'Stopping the export at the next safe point — whatever is running right now has to finish first.',
    )
  }

  /** The one end-of-everything toast: a line for the Daz leg, one per Houdini
   *  project, the failures inline, and the total time across all legs. */
  function emitFinalReport() {
    // The run's own facts, before clearPipeline resets this window's state.
    const interrupted = interruptedRef.current
    clearPipeline()
    const report = runReportRef.current
    runReportRef.current = null
    interruptedRef.current = false
    if (!report) return
    const lines: Array<string> = []
    let anyFailed = false
    let totalMs = 0
    let totalKnown = true
    // Legs an earlier window watched, restored from the run plan — they lead,
    // because they happened first. Their timings died with that window, so a
    // restored run reports no total. Warning entries (see
    // CARRIED_WARNING_PREFIX) are split back out for the toast loop below —
    // they are not report lines in any window.
    const carriedWarnings: Array<string> = []
    if (report.carried?.length) {
      for (const line of report.carried) {
        if (line.startsWith(CARRIED_WARNING_PREFIX)) {
          carriedWarnings.push(line.slice(CARRIED_WARNING_PREFIX.length))
        } else {
          lines.push(line)
        }
      }
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
      lines.push(...tidyRunErrors(d.errors))
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
    // An interrupted run never says "finished": the legs it did run are
    // reported exactly as they came back, but the run as a whole stopped
    // short, and the counts describe what ran — not what was asked for.
    const title = interrupted
      ? `DTH Export interrupted${totalKnown && totalMs > 0 ? ` after ${formatElapsed(totalMs)}` : ''}.`
      : `DTH Export finished${totalKnown && totalMs > 0 ? ` in ${formatElapsed(totalMs)}` : ''}.`
    if (interrupted) {
      lines.push('Stopped on request — anything not listed above did not run.')
    }
    const body = lines.join('\n') || undefined
    // The warnings go up FIRST, the report LAST, so the run's outcome is the
    // newest — and topmost — toast. Each warning is its own toast in its own
    // state: a network's pre-flight complaint next to a green summary was
    // read as neither (the checkmark said done, the body asked "Continue
    // anyway?" about a question 456.py had answered minutes earlier).
    for (const problem of carriedWarnings) {
      exportWarningToast('Exported with warnings', problem)
    }
    for (const leg of report.houdini) {
      for (const problem of leg.warnings ?? []) {
        exportWarningToast(`${leg.label ?? 'Houdini'}: exported with warnings`, problem)
      }
    }
    if (interrupted) exportFinishToast('info', title, body)
    else if (anyFailed) exportFinishToast('warning', title, body)
    else exportFinishToast('success', title, body)
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
          // Finished legs' warnings ride as ⚠-prefixed entries so an adopting
          // window can put them back into warning toasts (see
          // CARRIED_WARNING_PREFIX).
          reportLines: [
            ...(report?.carried ?? []),
            ...(report?.daz
              ? [
                  `Daz: ${report.daz.total - report.daz.failed}/${report.daz.total} scene${report.daz.total === 1 ? '' : 's'} exported`,
                  ...report.daz.errors,
                ]
              : []),
            ...(report?.houdini.flatMap((leg) => [
              leg.line,
              ...(leg.warnings ?? []).map(
                (problem) => `${CARRIED_WARNING_PREFIX}${labelledWarning(leg.label ?? 'Houdini', problem)}`,
              ),
            ]) ?? []),
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
    // The claim is news, and the panel must SAY it: the bridge writes a
    // `running` result before the work, but nothing here re-published, so the
    // line sat on "waiting for the editor to pick the job up" through the
    // whole import and then jumped to the outcome (measured 2026-08-19). The
    // freeze is named because it is real: the import blocks Unreal's game
    // thread for minutes, and an unresponsive editor over a "waiting" line
    // reads as a hang.
    if (state?.state === 'running') {
      const running = `Unreal; ${stemOf(uprojectPath)} is importing — the editor freezes while the DazToHue pipeline runs`
      if (unrealStatusRef.current !== running) {
        unrealStatusRef.current = running
        publishPipeline(progressRef.current, houdiniRef.current)
      }
    }
    if (state?.state !== 'finished') return
    unrealWatchRef.current = ''
    const what = state.reimported ? 're-imported' : 'imported'
    const landed = `${what} ${state.assets} asset${state.assets === 1 ? '' : 's'}${
      state.destination ? ` in ${state.destination}` : ''
    }`
    // THREE outcomes, not two. The bridge imports each export set on its own and
    // reports `done` as long as one landed, so "some worked, some didn't" is a
    // real state — and it used to be reported as unqualified success, which is
    // the one thing this leg must never do.
    //
    // The outcome is a sticky toast, and it ENDS the run: this leg is always
    // the run's last, so its answer is the moment the panel has nothing left
    // to show. It used to become the status line of a panel that then sat at
    // 100% forever (measured 2026-08-19, the first live in-place re-import) —
    // done work with no way to be done.
    if (!state.error) unrealOutcomeToast('success', `Unreal: ${landed}.`)
    else if (state.sets > 0) unrealOutcomeToast('warning', `Unreal: ${landed} — but ${state.error}`)
    else unrealOutcomeToast('error', `Unreal: import failed — ${state.error}`)
    clearPipeline()
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
      // An interrupted batch is finished only in the sense that the file is
      // gone: rows the generated scripts SKIPPED come back `done`, so neither
      // the counts nor the Houdini continuation may be believed. The api
      // layer's flag is the authority (it survives a reload); this window's
      // own memory covers the poll that lands before the flag is written back.
      const interrupted = run.interrupted || interruptedRef.current
      if (interrupted) interruptedRef.current = true
      // The Runner's rows are only half the outcome: a script that bailed
      // still returns, so its row comes back `done`. The other half is what
      // the scripts wrote about themselves (`scriptFailures`) — without it a
      // run that produced NOTHING reports "1 scene exported", which is the one
      // thing a finish report must never do.
      //
      // And the THIRD half is the disk: a script the Daz script engine kills
      // at the C++ level writes neither a row failure nor a run-log entry —
      // its row is `done`, the ROM log (stamped before the export block) says
      // ok, and the export folder holds a 0-byte `.dth` beside the sweep's
      // un-restored `.dthprev` backups (measured 2026-08-21: the DTH Exporter
      // crashed 2 s into the Alembic export and the run reported "1/1 scene
      // exported in 32s", then Houdini cooked the corpse into a 17-second
      // "success"). The landed guard judges the files the Houdini leg would
      // actually consume; a dead set fails its scene and drops out of the
      // continuation scope. ROM-only wrote no set — nothing to judge.
      //
      // Judged only for the scenes nothing has counted YET. `failed +
      // scriptFailures.length` is a true failure count precisely because those
      // two are deduped against each other (see `scriptRunFailures`); a third
      // channel added on top has to join that dedupe or it breaks the sum. It
      // is not a theoretical overlap: `rom-export` stamps the run log before
      // the export block, so a scene whose ROM leg errored AND whose export
      // then crashed hits both — counted twice, `failedTotal` reaches
      // `run.total`, and a HEALTHY sibling scene loses its Houdini leg under a
      // "0 exported" report.
      const countedFailed = new Set(
        [...run.failedScenes, ...run.scriptFailures.map((failure) => failure.scene)].map(
          normalizeSceneKey,
        ),
      )
      const alreadyCounted = (scene: string): boolean => countedFailed.has(normalizeSceneKey(scene))
      const verified =
        !interrupted && run.mode !== 'rom-only'
          ? await verifyDazExportsLanded({
              data: {
                projectId,
                id: character.id,
                scenes: run.scenes.filter((scene) => !alreadyCounted(scene)),
                requireDth: run.mode !== 'hair-only',
              },
            }).catch(() => [])
          : []
      // Only the DEAD ones fail a scene. A set that merely carries leftover
      // backups landed — reporting it as a failure cost a healthy scene its
      // Houdini leg (measured 2026-08-21, on a run whose `.abc` and `.dth`
      // were both correct and full-size).
      const deadSets = verified.filter((set) => set.reason)
      const setWarnings = verified.filter((set) => !set.reason && set.warning)
      const failedTotal = Math.min(
        run.total,
        run.failed + run.scriptFailures.length + deadSets.length,
      )
      // Composed RAW: the stashed report tidies when it renders, and the toast
      // below tidies its own copy — one cap over the whole list either way,
      // rather than one per half (which would count the elided tail twice).
      const errors = [
        ...run.errors,
        ...scriptFailureLines(run.scriptFailures),
        ...deadSets.map(
          (set) =>
            `${set.label}: the Daz export did not land — ${set.reason}. Check Daz's log, then export this scene again.`,
        ),
        // Not failures — the export landed. Said once, where the run's other
        // observations are, so the folder state is visible without pretending
        // the scene is broken.
        ...setWarnings.map((set) => `${set.label}: ${set.warning}`),
      ]
      const deadScenes = new Set(deadSets.map((set) => set.scene))
      // The Houdini scope is what this run VERIFIED — and every failure
      // channel drops its scene, not only the disk one. A scene that failed
      // out loud has a folder that looks LANDED: the script's failure path
      // renames the sweep's `.dthprev` backups back, so what sits there is the
      // PREVIOUS export. Handing it on imports last week's character wearing
      // this run's green checkmark — the same cascade the disk guard exists to
      // stop, entered through the door that reported itself honestly.
      const landedScenes = run.scenes.filter(
        (scene) => !deadScenes.has(scene) && !alreadyCounted(scene),
      )
      const continuing =
        !interrupted &&
        run.houdiniProjects.length > 0 &&
        failedTotal < run.total &&
        // A continuation with NOTHING verified behind it would cook whatever
        // the export folder held before this run — today's stale files wearing
        // this run's green checkmark.
        landedScenes.length > 0 &&
        // `skip` means no Houdini leg at all — the projects may still be
        // CHECKED in the panel (the list goes inert, it doesn't clear).
        run.houdiniMode !== 'skip'
      if (continuing) {
        runReportRef.current = {
          daz: {
            total: run.total,
            failed: failedTotal,
            errors,
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
              networks: landedScenes.map(stemOf),
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
          // Only the VERIFIED scenes — a dead set's networks would import
          // whatever its export folder held before this run.
          landedScenes,
        )
        return
      }
      // No export continuation — the batch IS the whole process: report now.
      const scenes = `${run.total} scene${run.total === 1 ? '' : 's'}`
      const took = run.elapsedMs !== undefined ? ` in ${formatElapsed(run.elapsedMs)}` : ''
      if (interrupted) {
        // Deliberately NO scene count: the studio cannot tell a scene the
        // Runner exported from one whose script saw the flag and returned —
        // both come back `done`. What it knows for certain is that the user
        // stopped it, and where to look for what actually happened.
        exportFinishToast(
          'info',
          `DTH Export interrupted${run.elapsedMs !== undefined ? ` after ${formatElapsed(run.elapsedMs)}` : ''}.`,
          'Stopped on request. Scenes that had not started were skipped; the ROM run log shows which scene was interrupted mid-build.',
        )
        interruptedRef.current = false
        // The run ends HERE — an accumulated report belongs to a process that
        // no longer has an end, and would otherwise fire on a later, unrelated
        // Houdini finish.
        runReportRef.current = null
        clearPipeline()
        return
      }
      if (failedTotal > 0) {
        const shown = tidyRunErrors(errors)
        toast.warning(`DTH Export finished — ${failedTotal} of ${scenes} failed${took}.`, {
          id: EXPORT_TOAST_ID,
          duration: Infinity,
          description: shown.length ? shown.join('\n') : undefined,
        })
      } else {
        exportFinishToast('success', `DTH Export finished — ${scenes} exported${took}.`)
      }
      // No Houdini continuation — the Daz cards end here. A SKIP run still has
      // its third leg: no Houdini means the send happens now, off the exports
      // already on disk, instead of after a queue.
      clearPipeline()
      if (run.unrealProjects.length > 0 && failedTotal < run.total) {
        unrealTargetsRef.current = run.unrealProjects
        unrealSetsRef.current = run.unrealSets
        // The send is still the run: its rows + the bar carry it (the clean
        // queue toasts nothing — see emitUnrealSendToasts), and the outcome
        // toast ends it — the same shape as the Unreal-only run. Without this
        // the leg was invisible from the file write until the editor answered.
        pipelineRef.current = {
          daz: [],
          houdini: [],
          unreal: unrealTargetsFrom(run.unrealProjects, run.unrealSets, undefined),
        }
        publishPipeline(null, null)
        void sendToUnreal().then((lines) => {
          publishPipeline(null, null)
          emitUnrealSendToasts(lines)
        })
      }
      return
    }
    if (run.state === 'dead') {
      setProgress(null)
      clearPipeline()
      // As sticky as the finish: a run dying while the user is away must not
      // evaporate before they return.
      exportFinishToast(
        'error',
        'DTH Export did not finish — Daz Studio is no longer running (or the job file disappeared).',
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
        // the panel that chose it.
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
      // 456.py stopped between nodes because the flag was there. The projects
      // behind this one must not start — and the report has to say the batch
      // was cut short, not that it was all there was to do.
      if (run.cancelled) {
        interruptedRef.current = true
        houdiniQueueRef.current = null
      }
      // A bare "nothing to export" is undiagnosable — point at the console
      // log, which names what was wanted vs found and survives the run.
      const summary =
        run.summary || 'nothing to export (details: .dth_houdini_console.log in the character folder)'
      const took = run.elapsedMs !== undefined ? ` in ${formatElapsed(run.elapsedMs)}` : ''
      // The HDA's pre-flight check asks "Continue anyway?" and 456.py answers
      // Yes — so this run is the only place its complaints are ever seen, and
      // the result file holding them is deleted as this run ends. They become
      // WARNING toasts of their own beside the final report, never lines in
      // its body: "the export worked" and "this network has problems" are
      // different messages in different states, and one toast wearing a green
      // checkmark over both read as neither. tidyRunErrors strips the
      // already-answered question and collapses per-node repeats (one dialog
      // often fires per export node); the summary line only notes they exist.
      const warnings = tidyRunErrors(run.problems)
      const detail = [run.error, warnings.length > 0 ? 'finished with warnings' : '']
        .filter(Boolean)
        .join(' · ')
      const label = currentHipRef.current || 'Houdini'
      // The finished state is the only snapshot with every network status
      // FINAL — the last `running` poll almost always predates the closing
      // node's entry (it lands moments before the state flips, between two
      // polls), so a memo left at that snapshot shows the last network as
      // never-run. Overwrite it with the truth while the run can still say it.
      // NOT verbatim on a cancel: 456.py marks the networks its interrupt
      // skipped `skipped`, which renders as done — the pure rule keeps those
      // looking unstarted (see houdiniNetworkMemoAtFinish).
      const finishedHip = pipelineRef.current?.houdini.find((one) => one.label === label)
      if (finishedHip) {
        const memo = houdiniNetworkMemoAtFinish(
          hipNetworkMemoRef.current[finishedHip.path],
          run.networks,
          run.cancelled,
        )
        if (memo) hipNetworkMemoRef.current[finishedHip.path] = memo
      }
      const report = runReportRef.current
      if (report) {
        report.houdini.push({
          line: `${label}: ${summary}${run.cancelled ? ' — interrupted' : ''}${took}${detail ? ` — ${detail}` : ''}`,
          failed: run.failed > 0 || Boolean(run.error),
          elapsedMs: run.elapsedMs,
          label,
          warnings,
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
      // NOT after an interrupt: what is on disk then is a half-finished
      // export, and handing that to Unreal would deliver a partial import as
      // if it were the run. `onInterrupt` already drops the targets in the
      // window that asked; this covers the run RESTORED into a window that
      // didn't (adoptHoudiniRun re-arms them from the plan).
      const unrealLines = (run.cancelled ? [] : await sendToUnreal()).map((one) => one.line)
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
        if (run.cancelled) {
          interruptedRef.current = false
          toast.info(`Houdini export interrupted — ${summary}${took}.`, options)
        } else if (run.failed > 0 || run.error) {
          toast.warning(`Houdini export finished — ${summary}${took}.`, options)
        } else {
          toast.success(`Houdini export finished — ${summary}${took}.`, options)
        }
        // This leg IS the whole report here — its warnings ride beside it, in
        // their own state, exactly as emitFinalReport does for a full run.
        for (const problem of warnings) {
          exportWarningToast(`${label}: exported with warnings`, problem)
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
            // what already finished must not be lost with it. Carried warnings
            // keep their content but drop the marker: on a DEAD run everything
            // folds into the one error toast, where the prefix is noise.
            ...(report.carried ?? []).map((line) =>
              line.startsWith(CARRIED_WARNING_PREFIX)
                ? line.slice(CARRIED_WARNING_PREFIX.length)
                : line,
            ),
            ...(report.daz
              ? [`Daz: ${report.daz.total - report.daz.failed}/${report.daz.total} exported`]
              : []),
            // Same rule for this window's own finished legs: the death toast
            // is the last place their warnings can surface, so they fold in.
            ...report.houdini.flatMap((leg) => [leg.line, ...(leg.warnings ?? [])]),
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

  // The Unreal leg found again the same way (reported 2026-08-19: a reload —
  // or just navigating away and back — mid-send "forgot" the rows, the status
  // line and the outcome). Its job files ARE its sidecar, exactly like the
  // other two legs' — `adoptUnrealImports` reads whose they are. Mount-only,
  // and it yields to anything this window already knows: a live watch or an
  // armed pipeline (the Houdini adoption covers the pre-send stretch; the job
  // files only exist after it, so in practice one of the two adopts).
  useEffect(() => {
    let active = true
    void adoptUnrealImports({ data: { projectId, id: character.id } })
      .then((adopted) => {
        if (!active || adopted.length === 0) return
        if (unrealWatchRef.current || pipelineRef.current) return
        unrealSentRef.current = true
        // One project is watched, exactly as the send armed it — the rows
        // name the rest.
        unrealWatchRef.current = adopted[0].uprojectPath
        const name = stemOf(adopted[0].uprojectPath)
        unrealStatusRef.current =
          adopted[0].state === 'waiting'
            ? `Unreal; queued for ${name} — waiting for the editor to pick the job up`
            : `Unreal; ${name} is importing — the editor freezes while the DazToHue pipeline runs`
        pipelineRef.current = {
          daz: [],
          houdini: [],
          unreal: adopted.map((one) => ({
            path: one.uprojectPath,
            label: stemOf(one.uprojectPath),
            sets: one.sets,
          })),
        }
        publishPipeline(null, null)
        // The first poll takes over from here: it arms the interval (its
        // state gates `watching`), keeps the status honest, and a result
        // written while nobody watched becomes the outcome toast now instead
        // of never.
        void refreshUnreal()
      })
      .catch(() => {
        // Read-only convenience, same as above.
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Every refresh funnels through ONE coalesced call: fetchExportRunProgress's
  // finished/dead handling is destructive (it deletes the job file and yields
  // the one outcome snapshot), so a burst of watch events — or an event landing
  // on top of a heartbeat tick — must not race two refreshes over that moment.
  // A refresh asked for while one is in flight runs AFTER it instead of
  // alongside it, so the last state change is never skipped either.
  // (refreshStatus is declared above; function declarations hoist.)
  const refreshStatusCoalesced = useCoalescedRefresh(refreshStatus)
  useRefetchOnFocus(
    () => {
      // Through the coalescer: a focus refresh can land while a watch event's
      // refresh is mid-flight.
      void refreshStatusCoalesced()
    },
    [],
    { immediate: true },
  )
  const watching =
    pending === true || progress !== null || houdini !== null || unrealRun !== null
  // Real file watching over the run's files (the job-file pair in the Daz
  // library, the progress log in app-data): the Runner's pickup rename, its
  // per-row rewrites and the final progress-100 write arrive as change events,
  // so the UI follows the batch the moment it moves instead of on the next
  // poll tick. Armed on `watching` alone — the watched DIRECTORIES never
  // change for a mounted editor, only the files inside them do.
  const runWatchArmed = useArmedWatch(watching, () =>
    watchExportRunFiles(() => void refreshStatusCoalesced()),
  )
  // With the watch armed, the interval degrades to a slow heartbeat — the net
  // under events a NAS share may swallow (lib/fs-watch.ts) and the only
  // prompter for states no file event announces (a Daz that died mid-run).
  // It stays the full-speed poll whenever the watch isn't there (a plain
  // browser, a failed start) — and while a Houdini or Unreal leg is live:
  // those legs' files are outside this watch and discover progress by polling
  // alone.
  const fastPoll = !runWatchArmed || houdini !== null || unrealRun !== null
  useEffect(() => {
    if (!watching) return
    const id = window.setInterval(
      () => {
        void refreshStatusCoalesced()
        // Cheap while nothing is armed: fetchHoudiniRunProgress returns null
        // immediately without touching the filesystem.
        void refreshHoudini()
        void refreshUnreal()
      },
      fastPoll ? 2500 : 15_000,
    )
    return () => window.clearInterval(id)
    // The refreshers only capture character.id, constant for a mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching, fastPoll])
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

  // (Removed with the Ctrl affordances: `onAbortRunning`, which deleted a
  // CLAIMED job file to unwedge the studio. Interrupt covers the case a user
  // actually has — stopping a run — and the leftover-file case it also served
  // is housekeeping, which lives in Settings → App Data
  // (`housekeeping-section.tsx` calls the same `clearExporterJobFiles`).)

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
        // Either half is enough: this window's click (immediate) or the run's
        // own recorded flag (survives a reload, and covers a run interrupted
        // from the window that started it).
        interrupting={interrupting || progress.interrupted === true}
        onInterrupt={() => void onInterrupt()}
      />
    )
  }

  if (houdini) {
    return (
      <HoudiniProgressButton
        houdini={houdini}
        // The Houdini leg's run state carries no interrupted flag of its own —
        // 456.py reports the stop only when it reaches a node boundary — so
        // this window's own click is what the button goes by. A reloaded
        // window shows "Working" again, which is the truth it can see.
        interrupting={interrupting || interruptedRef.current}
        onInterrupt={() => void onInterrupt()}
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
        ? 'This character has no export directory (it has no folder of its own) — move it into a folder first'
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
        // is off); the enabled button speaks for itself — the panel's title
        // popup holds the long description.
        title={blockedHint}
      >
        <DthLogo /> DTH Export
      </Button>
      {open && (
        <DthExportPanel
          projectId={projectId}
          character={character}
          unrealProjects={unrealProjects}
          onClose={() => setOpen(false)}
          onExported={(run) => {
            // A new run supersedes the previous outcome (see dismissFinishToasts).
            dismissFinishToasts()
            // …including the previous ROM run's findings for the scenes this
            // run supersedes. The handoff has already retired the same scenes
            // on disk (executeCharacterJobs → clearSceneRunLogs), off the SAME
            // rule — so this is purely the on-screen half: the red "errors in
            // the last ROM run" banner and the red morph rows go the moment the
            // new run appears, instead of hanging over a live progress bar
            // until Daz writes a fresh log.
            onRunStarted?.(scenesRetiredByRun(run.mode, run.scenes))
            runReportRef.current = null
            resetUnrealLeg()
            // A new run is never born interrupted — and the handoff itself
            // cleared the flag on disk (executeCharacterJobs).
            interruptedRef.current = false
            setInterrupting(false)
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
            // The claim wait, which used to block the panel's Start for up to
            // ten seconds before it would close. It belongs here: the run is
            // already on screen and abortable, so the waiting costs the user
            // nothing and the panel is gone the moment they click.
            //
            // Only for a Daz that was ALREADY up — one we launched ourselves has
            // its own startup to get through and is not late by being slow.
            if (run.dazWasRunning) {
              void awaitBatchPickup().then((claimed) => {
                // Never claimed: that "running" Daz is most likely shutting
                // down. The modal waits for the process to go and starts a
                // fresh one; the job file stayed pending, so it is still
                // abortable and the new Daz's Runner can claim it.
                if (!claimed) setDazClosing(true)
              })
            }
          }}
          // A skip-Daz run hands its selection straight to the Houdini queue —
          // the same machinery the after-batch continuation drives.
          onHoudiniQueue={(projects, scenes, unrealTargets, unrealSets, located) => {
            dismissFinishToasts()
            runReportRef.current = null
            resetUnrealLeg()
            interruptedRef.current = false
            setInterrupting(false)
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
          // the panel the rest of the pipeline lives in.
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
              // Re-publish AFTER the send: a refused target marked its rows
              // failed, and this is what turns them red instead of spinning.
              publishPipeline(null, null)
              emitUnrealSendToasts(lines)
            })
          }}
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
 * process and, the moment it is really gone, starts Daz itself — then stays up
 * until the batch is actually CLAIMED and worked (a launch against a
 * not-fully-dead instance forwards into it and dies, so an unverified launch
 * used to strand the batch behind a "Daz Studio started" toast; now it simply
 * launches again). It stands down when the batch shows real work (a live Daz
 * claimed late — that run belongs to the export watch) and closes on its own
 * when the handoff is gone (aborted, or finished) — so it can never sit under
 * a "DTH Export finished" toast. Both retries are bounded: the relaunches are
 * spaced and capped (a Daz that keeps exiting is reported, not started once a
 * second — the launch command reports the SPAWN, never that the process
 * lived), and a failed launch is retried every second and named in the modal
 * after repeated failures. Closing the modal only stops the watch: the batch
 * stays queued (the header button still aborts it).
 */
