import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'

import { cn } from '@dth/ui'
import dazLogo from '#/assets/daz-logo.png'
import houdiniLogo from '#/assets/houdini-logo.svg'
import unrealLogo from '#/assets/unreal-logo.svg'

/**
 * The header's live DTH-Export display: **one task list** for the whole run,
 * with **one progress bar** under it carrying the run's latest status message.
 *
 * The list is every unit of work the run comprises — each selected Daz scene,
 * then every DazToHue network of every Houdini project, then every export set
 * going into every Unreal project. One row per JOB, deliberately: two
 * characters re-imported into one Unreal project are two rows, because they
 * are two imports. It RENDERS bottom-up, like a log: the first job at the
 * bottom, later ones stacked above, so the latest work always sits at the
 * bottom edge, right above the bar.
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
  /** `failed` is FINISHED-but-wrong, not a third kind of pending: the row is
   *  over, and the list must not tick it off beside the ones that worked. The
   *  legs carry that verdict (456.py reports per-network `failed`, the Unreal
   *  bridge reports an error per job) and it used to be dropped on the way to
   *  the list — a failed DazToHue network read exactly like a good one. */
  status: 'waiting' | 'active' | 'done' | 'failed'
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

function ExportTaskCard({
  task,
  ordinal,
  leaving,
}: {
  task: ExportTask
  ordinal: number
  /** This row is on its way out — see {@link useRetiringTasks}. Still in the
   *  DOM (and still `data-task-status="done"`, because that is what it is)
   *  wearing the exit animation. */
  leaving?: boolean
}) {
  const active = task.status === 'active'
  const failed = task.status === 'failed'
  const done = task.status === 'done'
  const accent = ACCENT[task.kind]
  // "what · where" — either half can be absent (a Daz scene has no elsewhere; a
  // run that cannot name the work leaves the detail off rather than inventing
  // one). It rides the label's OWN line: one line per row, so the list stays a
  // compact queue readout rather than a card column.
  const sub = [task.detail, task.context].filter(Boolean).join(' · ')
  return (
    <li
      data-task={task.id}
      data-task-status={task.status}
      // Marked in the DOM as well as styled: "is this row leaving?" is a state
      // a test can wait on, and `task-retire` is unknown to tailwind-merge so
      // it survives `cn()`.
      data-task-leaving={leaving ? '' : undefined}
      className={cn(
        'relative flex items-center gap-2.5 overflow-hidden rounded-md py-1.5 pr-2 pl-3 transition-colors',
        leaving && 'task-retire',
        active
          ? 'bg-accent text-foreground'
          : failed
            ? // The one row that has to catch the eye AFTER the run moved on:
              //  it sits in a finished list, and a muted one would read as done.
              'bg-destructive/10 text-destructive'
            : done
              ? 'bg-card/40 text-muted-foreground'
              : 'bg-card/60 text-muted-foreground',
      )}
    >
      {/* The leg's color rides a left bar — full strength on the row being
          worked, a hairline on the rest, so a queue reads as a list rather
          than a row of paint. A failed row wears the destructive edge instead:
          which LEG it was matters less than that it did not work. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-[3px] rounded-full',
          failed ? 'bg-destructive' : accent,
          active || failed ? 'opacity-100' : 'opacity-40',
        )}
      />
      <span className="w-4 shrink-0 text-right text-[11px] tabular-nums opacity-50">{ordinal}.</span>
      {/* One mark per state: the run's spinner on the active row, a tick on a
          finished one, a cross on one that failed, the leg's dot on everything
          still to come. The mark is not decoration — it is the only thing
          telling a failed row from a finished one at a glance. */}
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {active ? (
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
        ) : failed ? (
          <X className="size-3.5" aria-label="failed" />
        ) : done ? (
          <Check aria-hidden className="size-3.5 opacity-60" />
        ) : (
          <span aria-hidden className={cn('size-1.5 rounded-full opacity-50', accent)} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs">
        <span
          className={cn(
            active ? 'font-semibold' : 'font-medium',
            // A failed row keeps its label plain: struck through, it would read
            // as one more thing crossed off the list.
            done && 'line-through decoration-1 opacity-70',
          )}
        >
          {task.label}
        </span>
        {sub && <span className="text-[11px] opacity-60"> · {sub}</span>}
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

/**
 * How long a ticked-off row STAYS on the list before it starts leaving.
 *
 * The tick is the acknowledgement — the row has to wear it long enough to be
 * seen, or the work appears to vanish unmarked and the user is left counting
 * what is missing. Retiring on the same frame as the tick would make the list
 * a place where things silently stop existing; this is the beat between "done"
 * and "gone".
 */
const RETIRE_DWELL_MS = 1100
/** How long the leaving animation runs. Must match `dth-task-retire` in
 *  `styles.css` — React drops the row when this elapses, so a shorter value
 *  here cuts the animation off mid-way. */
const RETIRE_EXIT_MS = 420

const NO_IDS: ReadonlySet<string> = new Set()

const without = (ids: ReadonlySet<string>, drop: ReadonlySet<string>): ReadonlySet<string> => {
  if (![...drop].some((id) => ids.has(id))) return ids
  const next = new Set(ids)
  for (const id of drop) next.delete(id)
  return next
}

/**
 * Finished work leaves the list: a `done` row wears its tick for
 * {@link RETIRE_DWELL_MS}, then animates out and is dropped.
 *
 * The list is a QUEUE readout, and a queue that only ever grows stops being
 * one — on a multi-scene run into several Houdini projects the rows still to
 * come scroll out of a five-row box behind rows that are over. Retiring the
 * finished ones keeps what is left of the run on screen, which is the only
 * thing the list is for.
 *
 * Only `done` retires. A `failed` row STAYS, permanently: it is the one row
 * that has to catch the eye after the run has moved on, and a list that
 * quietly disposed of failures beside successes would be the same lie the row
 * colour exists to prevent.
 *
 * Retirement is MEMORY, not a function of the props: the run keeps reporting a
 * finished task as `done` on every 2.5 s poll for the rest of the run, so
 * "has this row already had its moment?" is something only this hook knows.
 */
function useRetiringTasks(tasks: Array<ExportTask>): {
  /** Ids that are OVER — animated out and no longer rendered. */
  retired: ReadonlySet<string>
  /** Ids mid-exit: still rendered, wearing the animation. */
  leaving: ReadonlySet<string>
} {
  const [leaving, setLeaving] = useState(NO_IDS)
  const [retired, setRetired] = useState(NO_IDS)
  // Which ids already have a retirement running, with their timers so unmount
  // can cancel them. A ref rather than state because arming is a side effect
  // that must happen exactly ONCE per id — deriving "already armed" from
  // `leaving`/`retired` would re-arm all through the dwell, when the row is in
  // neither set yet.
  const armed = useRef(new Map<string, Array<ReturnType<typeof setTimeout>>>())

  useEffect(() => {
    for (const task of tasks) {
      if (task.status !== 'done' || armed.current.has(task.id)) continue
      const id = task.id
      const timers: Array<ReturnType<typeof setTimeout>> = []
      timers.push(
        setTimeout(() => {
          setLeaving((prev) => new Set(prev).add(id))
          timers.push(
            setTimeout(() => {
              setRetired((prev) => new Set(prev).add(id))
              setLeaving((prev) => without(prev, new Set([id])))
            }, RETIRE_EXIT_MS),
          )
        }, RETIRE_DWELL_MS),
      )
      armed.current.set(id, timers)
    }
    // An id the run no longer lists — a leg cleared wholesale at a baton pass,
    // or a whole new run in this same panel — is FORGOTTEN. Without this the
    // same scene in the next run would start life already retired, and never
    // appear at all.
    const live = new Set(tasks.map((task) => task.id))
    const forgotten = new Set<string>()
    for (const [id, timers] of armed.current) {
      if (live.has(id)) continue
      for (const timer of timers) clearTimeout(timer)
      armed.current.delete(id)
      forgotten.add(id)
    }
    if (forgotten.size > 0) {
      // Synchronizing React state with the external timer registry is this
      // effect's whole purpose; the sweep must land in the same commit that
      // cleared the timers, or a re-run scene starts life retired (#960).
      // oxlint-disable-next-line react/set-state-in-effect
      setRetired((prev) => without(prev, forgotten))
      // oxlint-disable-next-line react/set-state-in-effect
      setLeaving((prev) => without(prev, forgotten))
    }
  }, [tasks])

  // Timers outlive the render that made them; a panel torn down mid-dwell (the
  // run ends, the user navigates away) must not fire into a dead component.
  useEffect(() => {
    const running = armed.current
    return () => {
      for (const timers of running.values()) for (const timer of timers) clearTimeout(timer)
      running.clear()
    }
  }, [])

  return { retired, leaving }
}

export function ExportTaskList({ tasks }: { tasks: Array<ExportTask> }) {
  // Finished rows tick off, then leave — see {@link useRetiringTasks}. The
  // ORDINAL still counts over the whole run, retired rows included, so a row's
  // number never changes under the user: "3." is the run's third job whether
  // or not jobs 1 and 2 are still on screen.
  const { retired, leaving } = useRetiringTasks(tasks)
  // What the pin effect below re-runs on: the rows actually ON SCREEN, by
  // identity and state. `tasks` is rebuilt every 2.5 s poll and `shown` is a
  // fresh array each render, so either as a dependency would re-pin the scroll
  // on every tick — including ticks that changed nothing.
  const shownKey = tasks
    .filter((task) => !retired.has(task.id))
    .map((task) => `${task.id}:${task.status}`)
    .join('|')
  const boxRef = useRef<HTMLOListElement>(null)
  const pinnedRef = useRef(false)
  // The list runs BOTTOM-UP — the first job at the bottom, later ones stacked
  // above — so the freshest row (the one being worked) sits at the bottom
  // edge, right above the bar, with the queue readable above it and finished
  // rows retiring off it. This effect pins that edge: scrollTop
  // arithmetic rather than scrollIntoView, because only the LIST may move —
  // scrollIntoView walks every scrollable ancestor and can drag the page.
  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    // The run's front: the active row, else the freshest finished one (the
    // legs' baton passes leave short stretches with nothing active). A row
    // mid-exit is explicitly NOT the front — pinning the view to something
    // collapsing to nothing scrolls to where the list is about to not be.
    const front =
      box.querySelector<HTMLElement>('[data-task-status="active"]') ??
      box.querySelector<HTMLElement>(
        '[data-task-status="done"]:not([data-task-leaving]), [data-task-status="failed"]',
      )
    if (!front) {
      // Nothing worked yet (a handoff waiting to be claimed): start the view
      // at the bottom — the run's beginning — then leave the user's own
      // scrolling alone.
      if (!pinnedRef.current) box.scrollTop = box.scrollHeight
      pinnedRef.current = true
      return
    }
    pinnedRef.current = true
    const boxRect = box.getBoundingClientRect()
    const rect = front.getBoundingClientRect()
    // Re-pin only when the front row has LEFT the box (the old `nearest`
    // courtesy): a 2.5s poll must not yank a user reading the queue.
    if (rect.top >= boxRect.top && rect.bottom <= boxRect.bottom + 1) return
    box.scrollTop += rect.bottom - boxRect.bottom
    // `shownKey` is the re-pin TRIGGER — the body reads only the DOM, and must
    // re-run exactly when the visible row set changes (#960).
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [shownKey])
  return (
    <ol
      data-export-tasks
      ref={boxRef}
      // A BOUNDED height, deliberately: the header sizes itself to its content,
      // so a list that grew with the run would inflate the whole page header
      // (and jump per row). Five one-line rows, then it scrolls.
      className="flex max-h-[9.75rem] min-h-0 flex-col gap-1 overflow-y-auto text-left"
    >
      {/* Rendered in REVERSE run order — the latest work at the bottom, like a
          log — while the ordinal keeps counting in RUN order, so the bottom row
          is "1." and the numbers climb up the queue. */}
      {tasks
        .map((task, index) => ({ task, ordinal: index + 1 }))
        .filter(({ task }) => !retired.has(task.id))
        .reverse()
        .map(({ task, ordinal }) => (
          <ExportTaskCard
            key={task.id}
            task={task}
            ordinal={ordinal}
            leaving={leaving.has(task.id)}
          />
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
    // Anchored ABOVE the header's button row (absolute against that row, which
    // is `relative`), so the list and the bar are EXACTLY as wide as the
    // buttons — never wider. It used to bring its own min-width and could
    // out-grow the button row, which read as a floating box. Out of flow, so a
    // run starting never resizes the header; the list's bounded height keeps
    // the panel's own growth in check (every row truncates, so narrow is
    // fine). The panel does NOT dock: `pipeline-scroll` fades and collapses it
    // on the header-collapse scroll timeline (styles.css) — it is a working
    // view for the top of the page.
    <div className="pipeline-scroll absolute inset-x-0 bottom-full mb-5 flex flex-col gap-2">
      {view.tasks.length > 0 && <ExportTaskList tasks={view.tasks} />}
      <RunProgressBar percent={view.percent} status={view.status} kind={view.kind} />
    </div>
  )
}
