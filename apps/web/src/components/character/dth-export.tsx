import { useEffect, useRef, useState } from 'react'
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
  dazStudioRunning,
  dismissExportRun,
  dismissHoudiniRun,
  executeCharacterJobs,
  exporterJobsPending,
  exporterJobsWorking,
  fetchExecuteScenes,
  fetchExportRunProgress,
  fetchExportRunnerGate,
  fetchHoudiniRunProgress,
  fileExists,
  launchDazForPendingJobs,
  openScene,
  startHoudiniExport,
} from '#/lib/rom/api.ts'
import { holdBusyCursor } from '#/lib/busy-cursor.ts'
import {
  formatElapsed,
  hipSelectionAfterToggle,
  houdiniModeForSelection,
  normalizeSceneKey,
  preCheckedScenes,
  scenesMissingExport,
  scenesMissingRomAnimation,
} from '#/lib/rom/execute-jobs.ts'

import type { ExecuteSceneStatus, ExportRunProgress, RunnerGate } from '#/lib/rom/api.ts'
import type { HoudiniRunState } from '#/lib/rom/houdini-jobs.ts'
import type { HoudiniRunMode, RunChoice } from '#/lib/rom/execute-jobs.ts'
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

/** A live clock riding a progress button (`· 4m 12s`) — self-ticking each
 *  second, so the watch's 2.5s poll doesn't own the cadence. Renders nothing
 *  when the start is unknown (another window's run, adopted for display). */
function ElapsedSince({ since }: { since?: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (since === undefined) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [since])
  if (since === undefined) return null
  return <> · {formatElapsed(Date.now() - since)}</>
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
    try {
      const started = await startHoudiniExport({
        data: { projectId, id: character.id, hipPath: first, scenes },
      })
      setHoudini({ state: 'starting', startedAtMs: Date.now() })
      const count = `${started.scenes} scene${started.scenes === 1 ? '' : 's'}`
      // Transient hand-over feedback — the sticky report waits for the END.
      toast.info(`Houdini is opening ${stem} — ${count} handed over.`)
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
    const [isPending, run] = await Promise.all([exporterJobsPending(), fetchExportRunProgress()])
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
        // Transient — the report waits for the end of the whole process.
        toast.info('Opening the Houdini project to export…')
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
            jumps anyway (the Runner's progress is rows ÷ total). The live
            clock rides along whenever this window saw the handoff go out. The
            DAZ mark names which app is doing the work — the run happens
            outside the studio, and this button is where the user looks to
            know who is busy (the Houdini leg below wears its own mark). */}
        <Loader2 className="animate-spin" />
        <img src={dazLogo} alt="Daz Studio" className="size-5 shrink-0 object-contain" />
        Exporting {progress.processed}/{progress.total}
        <ElapsedSince since={progress.startedAtMs} />
      </Button>
    )
  }

  if (houdini) {
    // The Daz batch is done and reported; Houdini is opening the project (or
    // already working through it). Same deal as above — clicking stops the
    // WATCH, never the export, which keeps running in the user's Houdini. But
    // the STUDIO drives the project queue, so with projects still waiting
    // their turn, stopping the watch also stops the orchestration — the
    // tooltip must say so. (Reading the ref in render is sound here: every
    // queue mutation is bracketed by a setHoudini, which re-renders.)
    const queuedNote = houdiniQueueRef.current ? ' — the queued projects will not start' : ''
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
            ? `Houdini is exporting — ${houdini.done} of ${houdini.total} node${houdini.total === 1 ? '' : 's'} done. Click to stop watching${queuedNote}.`
            : `Houdini is opening the project; the export starts once the scene has loaded. Click to stop watching${queuedNote}.`
        }
      >
        <Loader2 className="animate-spin" />
        <img src={houdiniLogo} alt="Houdini" className="size-5 shrink-0 object-contain" />
        {label}
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
          onExported={() => {
            // A new run supersedes the previous outcome (see dismissFinishToasts).
            dismissFinishToasts()
            runReportRef.current = null
            setPending(true)
            // Arm the progress view right away (0/n until Daz delivers).
            void refreshStatus()
          }}
          // A skip-Daz run hands its selection straight to the Houdini queue —
          // the same machinery the after-batch continuation drives.
          onHoudiniQueue={(projects, scenes) => {
            dismissFinishToasts()
            runReportRef.current = null
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
        const running = await dazStudioRunning()
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
  /** A handoff was written — the header button flips to Abort. */
  onExported: () => void
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
   *  "Export all" (the checked scenes don't scope that run). */
  const noExportChecked = houdiniMode === 'export-all' ? [] : scenesMissingExport(mode, status, checked)
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
        // too, so a plain Start does the WHOLE round trip. The studio has no
        // scene↔project map (that lives inside the `.hip`), so "the involved
        // projects" is approximated as ALL linked ones — 456.py only exports
        // the networks importing the selected scenes, so an uninvolved project
        // simply no-ops. Only seeds an untouched selection: a user pick wins.
        // Never under rom-only: that run writes no export, so there is no
        // continuation to arm (see hipSelectionAfterToggle for the full why).
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
            // No scenes = nothing to start from, whatever the modes say.
            checked.size === 0 ||
            (mode === 'houdini-only'
              ? checkedHips.size === 0 || noExportChecked.length > 0
              : !runner || runner.blocked || noRomChecked.length > 0)
          }
          title={
            mode !== 'houdini-only' && runner?.blocked
              ? 'The Runner plugin needs attention in Settings first'
              : checking
                ? mode === 'houdini-only'
                  ? 'Checking each scene for a Daz export on disk — a moment'
                  : 'Checking each scene for a saved ROM animation — a moment'
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
