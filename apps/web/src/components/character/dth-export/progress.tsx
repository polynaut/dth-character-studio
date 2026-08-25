/**
 * The DTH Export button's progress faces — the brand mark, the finish toasts,
 * the elapsed-time readout and the button states (idle, working,
 * interruptible) the three legs render: Daz and Houdini interruptible,
 * Unreal working-only (the editor owns the import).
 *
 * Split out of `dth-export.tsx`; nothing here changed in the move.
 */
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { CircleStop, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@dth/ui'
import dazLogo from '#/assets/daz-logo.png'
import dthLogo from '#/assets/dth-logo.webp'
import houdiniLogo from '#/assets/houdini-logo.svg'
import unrealLogo from '#/assets/unreal-logo.svg'
import { formatClock } from '#/lib/rom/execute-jobs.ts'
import type { ExportRunProgress } from '#/lib/rom/api.ts'
import type { HoudiniRunState } from '#/lib/rom/houdini-jobs.ts'

/** The DazToHue brand mark as a button icon. The button's automatic icon
 *  sizing only targets SVGs, so the img sizes itself — `size-6`, larger than
 *  the svg default; the mark's fine detail needs it. The host button keeps
 *  `px-3` by hand for the same reason (`has-[>svg]` doesn't see an img). */
export function DthLogo() {
  return <img src={dthLogo} alt="" aria-hidden className="size-6 shrink-0 object-contain" />
}

export const EXPORT_TOAST_ID = 'dth-export-finished'
export const HOUDINI_TOAST_ID = 'dth-houdini-finished'

/**
 * The finish reports are STICKY toasts (`duration: Infinity`): a batch runs for
 * many minutes while the user is away in Daz or Houdini, and a toast on a
 * 4-second timer is gone long before they come back. They leave on exactly
 * three things — the toast's own close button (the global Toaster renders
 * one), a NEW run starting from the panel (the outcome is superseded), and
 * the editor unmounting (navigated away; the report belongs to the page whose
 * run it was).
 */
export function dismissFinishToasts() {
  toast.dismiss(EXPORT_TOAST_ID)
  toast.dismiss(HOUDINI_TOAST_ID)
  for (const id of warningToastIds.splice(0)) toast.dismiss(id)
}

/** The warning toasts currently on screen — remembered so
 *  {@link dismissFinishToasts} can take them down with the report they belong
 *  to. Unlike the report they have no fixed id: each warning is its own toast
 *  and must not replace the summary or its siblings. */
const warningToastIds: Array<string | number> = []

/**
 * One WARNING toast per complaint the run answered on the user's behalf.
 *
 * The finish report used to carry these inside its own body, which put an
 * amber fact under a green checkmark: "export worked" and "this network has
 * problems" are different messages in different states, so each gets its own
 * toast (the report stays the run's outcome; a warning never sours it, and a
 * green summary never buries it). Sticky for the same reason the report is —
 * the user is away in Daz/Houdini for most of a run — and dismissed with it.
 */
export function exportWarningToast(title: string, description: string): void {
  warningToastIds.push(toast.warning(title, { duration: Infinity, description }))
}

/**
 * The Unreal leg's own finish line — the run's LAST word, landing minutes
 * after the run report fired (the editor answers on its own clock), so it is
 * a sticky toast of its own: writing it under {@link EXPORT_TOAST_ID} would
 * REPLACE the report it belongs beside. Tracked like the warnings, so a new
 * run or the editor unmounting sweeps it with the rest.
 */
export function unrealOutcomeToast(
  kind: 'success' | 'warning' | 'error',
  title: string,
): void {
  warningToastIds.push(toast[kind](title, { duration: Infinity }))
}

/**
 * The ONE way to raise the export run's finish report.
 *
 * Five paths end a run, all writing the same sticky toast id — and sonner
 * UPDATES a toast that already exists rather than replacing it, merging the new
 * fields over the old. A path that passed no `description` therefore inherited
 * the PREVIOUS report's body, which is how a run that exported one scene in 45s
 * ended up titled exactly that over a description of an earlier run's two
 * scenes in 7m 50s and 25m 32s: two different runs, welded into one toast that
 * contradicted itself.
 *
 * The cure is that `description` is ALWAYS passed, even when there is none:
 * sonner merges an update as `{ ...toast, ...data }`, so a key that is present
 * and `undefined` clears the old body, while a key that is absent inherits it.
 * The title and the body therefore always describe the same run.
 *
 * Deliberately NOT `toast.dismiss()` first: dismissing starts a removal, and a
 * toast re-created under the same id in the same tick is removed with it — the
 * finish report then never appears at all (caught by the houdini-only smoke).
 */
export function exportFinishToast(
  kind: 'success' | 'warning' | 'info' | 'error',
  title: string,
  description?: string,
): void {
  toast[kind](title, { id: EXPORT_TOAST_ID, duration: Infinity, description })
}

/** Status texts arrive lowercase from the logs — tooltips lead with a capital. */
export function capitalizeStatus(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A live digital clock riding a progress button (`04:12`, all four digits
 *  always rendered; an hour-plus run grows to `1:04:12`) — self-ticking each
 *  second, so the watch's 2.5s poll doesn't own the cadence. Renders nothing
 *  when the start is unknown (another window's run, adopted for display).
 *  Reserved width + tabular digits: the tick never resizes the button. */
export function ElapsedSince({ since }: { since?: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (since === undefined) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [since])
  if (since === undefined) return null
  return (
    <span className="inline-block min-w-[5ch] text-left tabular-nums">
      {/* A live clock renders wall time by definition; the 1s interval above
          owns the re-render cadence, so the value is stable per paint (#960). */}
      {/* oxlint-disable-next-line react/purity */}
      {formatClock(Date.now() - since)}
    </span>
  )
}

/**
 * The live **Working** button — the run's one control, on the two legs the
 * studio can stop. At rest it shows the leg's spinner, the mark of the app
 * doing the work and the elapsed clock; HOVERING it swaps the spinner for a
 * stop mark and the tooltip leads with what a click now does: **interrupt**
 * the run at its next safe point. The Unreal leg passes no `onInterrupt` —
 * there is nothing the studio could stop (the editor owns the import) — and
 * the button then promises nothing: no stop mark, no click, the status alone
 * as its tooltip.
 *
 * What a click promises is exactly what the runtimes can deliver, so the
 * tooltip says it in full: the flag is dropped, and the generated Daz scripts
 * + the DTH runtime + 456.py stop at their next checkpoint. The step running
 * at that moment finishes first — a Daz content load, one `doExport`, one
 * Houdini node are synchronous calls inside someone else's plugin, and the
 * alternative to waiting for them is killing a process mid-write.
 *
 * History: the interrupt was a separate button beside an INERT Working button
 * (and before that, a modifier-revealed Abort / Stop watching that could only
 * stop the studio's watch, never the run). Two buttons for one run out-grew
 * the panel above them; folding the stop into the button people already watch
 * removed the pair. The stray-click worry that made Working inert (a plain
 * click used to reset the WATCH mid-run, reading as "the export vanished") no
 * longer applies: a click asks the RUN to stop, safely and loudly, which is
 * the one thing a click on a live export button can mean.
 *
 * Once pressed it stops offering itself (`interrupting`): the flag is on
 * disk, pressing twice changes nothing, and a button still promising "Click
 * to interrupt" after the click reads as "that didn't work". The one thing
 * the old Abort could do that Interrupt cannot — clear a job file nothing
 * will ever finish (a Daz stuck on a modal reads no flag) — lives where
 * housekeeping belongs: **Settings → App Data**.
 */
export function WorkingButton({
  percent,
  barColor,
  appLogo,
  appName,
  status,
  interrupting,
  onInterrupt,
  since,
}: {
  /** The mini bar (::after, appears only in the collapsed header —
   *  styles.css) mirrors the pipeline's CURRENT meter. */
  percent: number
  barColor: string
  appLogo: string
  appName: string
  /** The leg's newest word — the tooltip's first line. */
  status: string
  /** The interrupt has been requested — the run is draining to its next stop
   *  point (either this window asked, or the restored watch says it did). */
  interrupting?: boolean
  /** Absent = this leg cannot be stopped from here (the Unreal import runs
   *  inside the editor) — the button is inert and says only its status. */
  onInterrupt?: () => void
  since?: number
}) {
  return (
    <Button
      variant="outline"
      className={`export-button-progress group px-3${interrupting ? ' cursor-wait' : ''}`}
      style={
        {
          '--export-progress': `${percent}%`,
          '--export-progress-color': barColor,
        } as CSSProperties
      }
      // Inert once the interrupt is on disk — the wait-cursor says "draining,
      // nothing more to click".
      onClick={interrupting ? undefined : onInterrupt}
      title={
        !onInterrupt
          ? status
          : interrupting
            ? 'Stopping at the next safe point — whatever is running right now (a scene load, one export call, one Houdini node) has to finish first.'
            : `${status}\n\nClick to interrupt: stop this export at the next point where stopping is safe. The ROM build stops between blocks, the export that would have followed is skipped, and every scene and Houdini project still queued is dropped. Everything already written stays.`
      }
    >
      {/* Just "Working" — the counts and percents live in the pipeline panel
          above (and this button's tooltip); a constant label plus the
          reserved-width clock keeps the button from resizing every tick. The
          app mark names who is busy — the run happens outside the studio, and
          the legs are told apart by their marks. The spinner is the hover
          swap's other half: pointer on = the stop mark, because the button's
          click IS the interrupt — so an interrupt-less leg never swaps. */}
      {interrupting || !onInterrupt ? (
        <Loader2 className="animate-spin" />
      ) : (
        <>
          <Loader2 className="animate-spin group-hover:hidden" />
          <CircleStop className="hidden text-destructive group-hover:block" />
        </>
      )}
      <img src={appLogo} alt={appName} className="size-5 shrink-0 object-contain" />
      {interrupting ? 'Stopping' : 'Working'}
      <ElapsedSince since={since} />
    </Button>
  )
}

/** The Daz leg's {@link WorkingButton}: the per-scene progress-log percent
 *  (falling back to row counts under an old Runner) on the emerald mini bar.
 *  The Runner renamed the job file and owns its progress — the studio just
 *  polls the file; the click interrupts the run itself. */
export function ExportProgressButton({
  progress,
  interrupting,
  onInterrupt,
}: {
  progress: Extract<ExportRunProgress, { state: 'running' }>
  interrupting: boolean
  onInterrupt: () => void
}) {
  const percent =
    progress.step?.percent ??
    (progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0)
  return (
    <WorkingButton
      percent={percent}
      barColor="var(--color-emerald-600)"
      appLogo={dazLogo}
      appName="Daz Studio"
      status={capitalizeStatus(progress.step?.message || 'working…')}
      interrupting={interrupting}
      onInterrupt={onInterrupt}
      since={progress.startedAtMs}
    />
  )
}

/** The Houdini leg's {@link WorkingButton}: the Daz batch is done and
 *  reported; Houdini is working (or opening the project). The orange mini bar
 *  mirrors the panel's stepwise Houdini scale (1 open-project step + 1 per
 *  network); the click interrupts — 456.py stops between nodes, closes its
 *  own Houdini, and the queued projects never start. A watch whose Houdini
 *  actually dies ends itself (liveness detection). */
export function HoudiniProgressButton({
  houdini,
  interrupting,
  onInterrupt,
}: {
  houdini: HoudiniRunState
  interrupting: boolean
  onInterrupt: () => void
}) {
  const percent =
    houdini.state === 'running' && houdini.total > 0
      ? Math.round(((1 + houdini.done) / (1 + houdini.total)) * 100)
      : 0
  return (
    <WorkingButton
      percent={percent}
      barColor="var(--color-orange-600)"
      appLogo={houdiniLogo}
      appName="Houdini"
      status={capitalizeStatus(
        (houdini.state === 'running' && houdini.activity?.lines.at(-1)) ||
          (houdini.state === 'running' ? 'exporting…' : 'opening project…'),
      )}
      interrupting={interrupting}
      onInterrupt={onInterrupt}
      since={
        houdini.state === 'starting' || houdini.state === 'running'
          ? houdini.startedAtMs
          : undefined
      }
    />
  )
}

/** The Unreal leg's {@link WorkingButton}: the export legs are done and the
 *  job is in the editor's hands — the run's last leg, so the header button
 *  must say Working until the editor answers (it used to drop back to the
 *  idle "DTH Export" the moment Houdini reported, while the panel above it
 *  showed the import; reported 2026-08-25). Inert by design — no
 *  `onInterrupt`, because the import runs inside Unreal and nothing here
 *  could stop it; clearing a job nothing claimed is housekeeping
 *  (Settings → App Data). The cyan mini bar mirrors the panel's Unreal
 *  fraction: an import is claimed (50) or it is not (0) — the bridge reports
 *  no finer progress. */
export function UnrealProgressButton({
  importing,
  status,
  since,
}: {
  /** The editor has claimed the job (`running`) — false while the job file
   *  still waits for an editor to pick it up. */
  importing: boolean
  status: string
  since?: number
}) {
  return (
    <WorkingButton
      percent={importing ? 50 : 0}
      barColor="var(--color-unreal-blue)"
      appLogo={unrealLogo}
      appName="Unreal Editor"
      status={status}
      since={since}
    />
  )
}

/** A stable empty default for the optional linked-`.uproject` list — a fresh
 *  `[]` per render is a new reference every time (and the lint gate says so). */
export const NO_UNREAL_PROJECTS: ReadonlyArray<string> = []

/** The empty checkbox selection, shared so a "nothing selected" render is the
 *  same object every time (it is set on every ineligible poll). */
export const EMPTY_SELECTION: ReadonlySet<string> = new Set()
