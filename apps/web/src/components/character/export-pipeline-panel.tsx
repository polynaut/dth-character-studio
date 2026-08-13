import { useEffect, useRef } from 'react'
import { Check, Loader2 } from 'lucide-react'

import { cn } from '@dth/ui'
import dazLogo from '#/assets/daz-logo.png'
import houdiniLogo from '#/assets/houdini-logo.svg'
import unrealLogo from '#/assets/unreal-logo.svg'

/**
 * The header's live DTH-Export display: **one task list** for the whole run,
 * with **one progress bar** under it carrying the run's latest status message.
 *
 * The list is every unit of work the run comprises, in the order it happens —
 * each selected Daz scene, then every DazToHue network of every Houdini
 * project, then every export set going into every Unreal project. One row per
 * JOB, deliberately: two characters re-imported into one Unreal project are two
 * rows, because they are two imports.
 *
 * It replaced three separate readouts (a narrow card column, a tail-mode log
 * window and a two-level meter row) that between them said the same thing three
 * ways. What the log window carried that the list cannot is the TRANSCRIPT —
 * only the newest line survives, as the bar's status line. The full output is
 * still on disk per leg (the Runner's progress log, `.dth_houdini_console.log`,
 * the Unreal editor's own log), which is where a post-mortem was always read.
 *
 * Pure presentation: `dth-export.tsx` computes the view each poll and the
 * EditorHeader places it above the whole button cluster.
 */

/** Which leg a task (or the bar) belongs to — decides its color and its mark. */
export type ExportTaskKind = 'daz' | 'houdini' | 'unreal'

export interface ExportTask {
  id: string
  /** The unit of work's OWN name: the Daz scene, the DazToHue network, the
   *  export set on its way into Unreal. */
  label: string
  /** What is going to happen to it — "ROM + Export", "Export only",
   *  "Re-import". Absent when this window cannot honestly say. */
  detail?: string
  /** WHERE it happens: the Houdini project holding the network, the Unreal
   *  project receiving the import. Absent on a Daz scene, which happens in the
   *  file it names. */
  context?: string
  kind: ExportTaskKind
  status: 'waiting' | 'active' | 'done'
}

export interface ExportPipelineView {
  /** Every job of the run, in run order. Empty only for a run adopted from
   *  another window before its rows are readable. */
  tasks: Array<ExportTask>
  /** The newest thing the run said — ONE line, printed with the bar. '' while
   *  a leg has yet to speak. */
  status: string
  /** 0–100 across the WHOLE run (see `runPercent` in `lib/rom/export-cards.ts`
   *  for how the active job's share is estimated). */
  percent: number
  /** Which leg is talking — the bar's fill color. */
  kind: ExportTaskKind
}

const ACCENT: Record<ExportTaskKind, string> = {
  daz: 'bg-emerald-500',
  houdini: 'bg-orange-500',
  unreal: 'bg-unreal-blue',
}

const LOGO: Record<ExportTaskKind, string> = {
  daz: dazLogo,
  houdini: houdiniLogo,
  unreal: unrealLogo,
}

const APP: Record<ExportTaskKind, string> = {
  daz: 'Daz Studio',
  houdini: 'Houdini',
  unreal: 'Unreal Engine',
}

function ExportTaskCard({ task, ordinal }: { task: ExportTask; ordinal: number }) {
  const active = task.status === 'active'
  const done = task.status === 'done'
  const accent = ACCENT[task.kind]
  // The subtitle is "what · where" — either half can be absent (a Daz scene has
  // no elsewhere; a run that cannot name the work leaves the detail off rather
  // than inventing one).
  const sub = [task.detail, task.context].filter(Boolean).join(' · ')
  return (
    <li
      data-task={task.id}
      data-task-status={task.status}
      className={cn(
        'relative flex items-center gap-2.5 overflow-hidden rounded-md py-1.5 pr-2 pl-3 transition-colors',
        active
          ? 'bg-accent text-foreground'
          : done
            ? 'bg-card/40 text-muted-foreground'
            : 'bg-card/60 text-muted-foreground',
      )}
    >
      {/* The leg's color rides a left bar — full strength on the row being
          worked, a hairline on the rest, so a queue reads as a list rather
          than a row of paint. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-[3px] rounded-full',
          accent,
          active ? 'opacity-100' : 'opacity-40',
        )}
      />
      <span className="w-4 shrink-0 text-right text-[11px] tabular-nums opacity-50">{ordinal}.</span>
      {/* One mark per state: the run's spinner on the active row, a tick on a
          finished one, the leg's dot on everything still to come. */}
      <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
        {active ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : done ? (
          <Check className="size-3.5 opacity-60" />
        ) : (
          <span className={cn('size-1.5 rounded-full opacity-50', accent)} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-xs',
            active ? 'font-semibold' : 'font-medium',
            done && 'line-through decoration-1 opacity-70',
          )}
        >
          {task.label}
        </span>
        {sub && <span className="block truncate text-[11px] opacity-60">{sub}</span>}
      </span>
      <img
        src={LOGO[task.kind]}
        alt={APP[task.kind]}
        title={APP[task.kind]}
        className={cn('size-4 shrink-0 object-contain', !active && 'opacity-50')}
      />
    </li>
  )
}

export function ExportTaskList({ tasks }: { tasks: Array<ExportTask> }) {
  const boxRef = useRef<HTMLOListElement>(null)
  // Keep the row being worked in view: the list is chronological and a long run
  // scrolls past the top of the box, so without this the interesting row walks
  // off the bottom. `nearest` so a list that already fits never jumps.
  useEffect(() => {
    const active = boxRef.current?.querySelector('[data-task-status="active"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [tasks])
  return (
    <ol
      data-export-tasks
      ref={boxRef}
      // A BOUNDED height, deliberately: the header sizes itself to its content,
      // so a list that grew with the run would inflate the whole page header
      // (and jump per row). Four rows of two lines, then it scrolls.
      className="flex max-h-[10.5rem] min-h-0 flex-col gap-1 overflow-y-auto text-left"
    >
      {tasks.map((task, index) => (
        <ExportTaskCard key={task.id} task={task} ordinal={index + 1} />
      ))}
    </ol>
  )
}

/**
 * The run's one meter: the status line printed above the track (the newest
 * thing the run said, one line — it is truncated rather than wrapped, so the
 * panel's height never moves), the percentage at the right, the track below.
 */
function RunProgressBar({
  percent,
  status,
  kind,
}: {
  percent: number
  status: string
  kind: ExportTaskKind
}) {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <div
      role="progressbar"
      aria-label="Export progress"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={status || undefined}
      data-progressbar="run"
      data-percent={Math.round(clamped)}
      className="flex min-w-0 flex-col gap-1"
    >
      <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
        <span data-export-status className="min-w-0 flex-1 truncate">
          {status}
        </span>
        <span className="shrink-0 tabular-nums">{Math.round(clamped)}%</span>
      </div>
      <div className="h-1.5 min-w-0 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-[width] duration-500', ACCENT[kind])}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}

export function ExportPipelinePanel({ view }: { view: ExportPipelineView }) {
  if (view.tasks.length === 0 && !view.status) return null
  return (
    // Spans the header's whole button-cluster grid (the buttons keep the second
    // column below), so the list and the bar are EXACTLY as wide as the whole
    // button row — a panel narrower than the buttons it sits on reads as a
    // floating box. The min-width is what a short button row is widened to, so
    // a run starting cannot make the header narrower than the list needs.
    // `justify-end` pins the list to the bottom, right above the bar and the
    // buttons. The panel does NOT dock: `pipeline-scroll` fades it out on the
    // header-collapse scroll timeline (styles.css) — it is a working view for
    // the top of the page.
    <div className="pipeline-scroll col-span-2 row-start-1 flex min-h-0 w-full min-w-[26rem] flex-col justify-end gap-2">
      {view.tasks.length > 0 && <ExportTaskList tasks={view.tasks} />}
      <RunProgressBar percent={view.percent} status={view.status} kind={view.kind} />
    </div>
  )
}
