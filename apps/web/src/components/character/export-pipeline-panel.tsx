import { useEffect, useRef, useState } from 'react'

import { cn } from '@dth/ui'
import { formatClock } from '#/lib/rom/execute-jobs.ts'

/**
 * The header's live DTH-Export pipeline display: a narrow task-card column
 * (every Daz scene of the selection, then every Houdini project — the
 * chronological order the run works through) beside the tail-mode log window.
 * The ACTIVE task wears its kind's solid color (the selected-card look),
 * waiting tasks sit grayish with the kind's accent edge — and a finished task
 * drops away toward the bottom right while the ones behind it slide up, a
 * little like Tetris.
 *
 * Pure presentation: `dth-export.tsx` computes the view each poll and the
 * EditorHeader places this above the whole button cluster.
 */

export interface ExportTask {
  id: string
  label: string
  /** Extra tooltip context — e.g. the networks a Houdini project exports. */
  detail?: string
  kind: 'daz' | 'houdini'
  status: 'waiting' | 'active' | 'done'
}

export interface ExportProgressBar {
  /** 0–100. */
  percent: number
  label: string
  /** Which leg the bar measures — the fill wears that kind's color, the same
   *  identity the task cards carry. */
  kind: 'daz' | 'houdini'
  /** When the CURRENT step began (first seen) — the label then carries a
   *  self-ticking `· 02:10`, so the minutes-long silent stretches inside a
   *  synchronous exporter call visibly tick instead of reading as stuck. */
  sinceMs?: number
}

export interface ExportPipelineView {
  /** Task cards, chronological. Empty for an adopted run (no identity). */
  tasks: Array<ExportTask>
  /** The live log-window content — whichever leg is talking right now. Lines
   *  only: the scene lives on the active task card, the percent on the meter
   *  and the latest status text on the meter's label, so the window carries
   *  no caption row. */
  log: { lines: Array<string> } | null
  /** The full-width bar row above tasks+log: `current` = the unit being
   *  worked right now (the per-scene progress-log percent on the Daz leg, the
   *  stepwise open-project-then-networks scale on the Houdini leg); `overall`
   *  appears only when the leg spans more than one unit (several scenes /
   *  several networks) — the two-level display. */
  bars: { current: ExportProgressBar; overall?: ExportProgressBar } | null
}

/** How long the fly-out plays before the slot collapses, and how long the
 *  collapse takes — two phases so the card can escape UNclipped first. */
const FLY_MS = 450
const COLLAPSE_MS = 350

function ExportTaskCard({
  task,
  ordinal,
  departing,
}: {
  task: ExportTask
  /** 1-based chronological number, stable for the whole run (finished tasks
   *  keep their slot in the data, so later cards never renumber). */
  ordinal: number
  departing: boolean
}) {
  const solid =
    task.kind === 'daz'
      ? 'border-emerald-600 bg-emerald-600 text-white'
      : 'border-orange-600 bg-orange-600 text-white'
  const accent = task.kind === 'daz' ? 'border-l-emerald-600' : 'border-l-orange-600'
  return (
    <div
      data-task={task.id}
      data-task-status={departing ? 'done' : task.status}
      className={cn(
        'truncate rounded-md border border-l-4 px-2 py-1 text-xs font-bold transition-all',
        task.status === 'active' || departing
          ? solid
          : cn('border-border bg-muted/60 text-muted-foreground', accent),
        departing && 'translate-x-28 translate-y-12 rotate-6 opacity-0',
      )}
      style={{ transitionDuration: `${FLY_MS}ms` }}
      title={task.detail ? `${task.label}\n${task.detail}` : task.label}
    >
      <span className="opacity-60 tabular-nums">{ordinal}.</span> {task.label}
    </div>
  )
}

export function ExportTaskCards({ tasks }: { tasks: Array<ExportTask> }) {
  // The Tetris exit, in two phases per finished task: FLY (the slot keeps its
  // height while the card sails off bottom-right, unclipped) then COLLAPSE
  // (the empty slot's height animates away, sliding the rest up). Phase state
  // lives here so the DATA can flip to done instantly while the cards catch up.
  const [flying, setFlying] = useState<ReadonlySet<string>>(new Set())
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(() => {
    for (const task of tasks) {
      if (task.status !== 'done' || flying.has(task.id)) continue
      setFlying((prev) => new Set(prev).add(task.id))
      timers.current.push(
        setTimeout(() => setCollapsed((prev) => new Set(prev).add(task.id)), FLY_MS),
      )
    }
  }, [tasks, flying])
  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  // Only 4 cards show in full (the column spans the log AND meter rows); the
  // 5th fades out through a gradient mask and everything past it sits in a
  // collapsed slot (which ANIMATES open as the queue moves up — the same
  // slide the tetris collapse uses). Position counts only live slots, so a
  // flying card still occupies its place until its slot has collapsed.
  const visibleIds = tasks.filter((task) => !collapsed.has(task.id)).map((task) => task.id)

  return (
    <div className="col-start-1 row-start-1 row-span-2 flex min-h-0 w-40 shrink-0 flex-col">
      {tasks.map((task, index) => {
        const isFlying = flying.has(task.id)
        const isCollapsed = collapsed.has(task.id)
        const position = visibleIds.indexOf(task.id)
        const hidden = isCollapsed || position >= 5
        return (
          <div
            key={task.id}
            className={cn(
              'transition-all',
              hidden ? 'max-h-0 pb-0 opacity-0' : 'max-h-10 pb-1.5',
              // A hidden slot may clip — its card is gone or beyond the list's
              // window. A LIVE slot must not, or the fly-out would be cut off
              // mid-flight.
              hidden ? 'overflow-hidden' : 'overflow-visible',
              position === 4 &&
                !isCollapsed &&
                '[mask-image:linear-gradient(to_bottom,#000_0%,transparent_90%)]',
            )}
            style={{ transitionDuration: `${COLLAPSE_MS}ms` }}
          >
            <ExportTaskCard task={task} ordinal={index + 1} departing={isFlying} />
          </div>
        )
      })}
    </div>
  )
}

export function ExportActivityLog({ log }: { log: { lines: Array<string> } }) {
  const boxRef = useRef<HTMLDivElement>(null)
  // Tail mode: whenever lines arrive, keep the newest one in view.
  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [log.lines])
  return (
    // Fills whatever height the panel row gives it (full header at rest, less
    // when the sticky header docks) — the grid places it in the buttons'
    // shared column, so its width IS theirs. Lines only, no caption row.
    <div
      data-export-log
      className="col-start-2 row-start-1 flex min-h-0 min-w-0 flex-col rounded-md border bg-card/80 px-2.5 py-1.5 text-left"
    >
      <div
        ref={boxRef}
        className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px] leading-4 whitespace-pre-wrap break-all text-muted-foreground"
      >
        {log.lines.map((line, index) => (
          // Index keys are sound here: the list is an append-only rolling tail.
          // eslint-disable-next-line react/no-array-index-key
          <div key={index}>{line}</div>
        ))}
      </div>
    </div>
  )
}

/** One progress meter. The fill wears the LEG's color (the entity, like its
 *  cards); every text stays in muted ink. `emphasis` = the overall (top) bar
 *  of a two-level display, slightly taller. */
function ProgressBar({ bar, emphasis = false }: { bar: ExportProgressBar; emphasis?: boolean }) {
  const percent = Math.min(100, Math.max(0, bar.percent))
  // Status texts arrive lowercase from the logs ("opening scene") — the label
  // is a caption, so it leads with a capital.
  const label = bar.label.charAt(0).toUpperCase() + bar.label.slice(1)
  // The per-step clock ticks on its own — the poll only moves at step
  // boundaries, and the whole point is showing life BETWEEN them.
  const [, tick] = useState(0)
  useEffect(() => {
    if (bar.sinceMs === undefined) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [bar.sinceMs])
  return (
    <div data-progressbar={emphasis ? 'overall' : 'current'} data-percent={Math.round(percent)}>
      <div className="mb-0.5 flex items-baseline gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{label}</span>
        {bar.sinceMs !== undefined && (
          <span className="shrink-0 tabular-nums">· {formatClock(Date.now() - bar.sinceMs)}</span>
        )}
        <span className="ml-auto shrink-0 tabular-nums">{Math.round(percent)}%</span>
      </div>
      <div className={cn('overflow-hidden rounded-full bg-muted', emphasis ? 'h-2' : 'h-1.5')}>
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            bar.kind === 'daz' ? 'bg-emerald-600' : 'bg-orange-600',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

export function ExportPipelinePanel({ view }: { view: ExportPipelineView }) {
  if (view.tasks.length === 0 && !view.log && !view.bars) return null
  return (
    // Lives inside the header's 2-column grid and inherits its tracks
    // (subgrid): the LOG WINDOW shares its column with the button row below,
    // so the two are always exactly as wide as each other — and the meter row
    // sits UNDER the log at the same width. The task cards fill the first
    // column across BOTH rows (room for 4 full cards). min-h-0 rows so the
    // panel fills whatever height the header has (the log is the flexible
    // part; the meter row keeps its size). Width is content-stable mid-run:
    // the buttons' "Working" label + reserved clock never resize.
    <div className="pipeline-scroll col-span-2 row-start-1 grid min-h-0 grid-cols-subgrid grid-rows-[minmax(0,1fr)_auto] gap-y-2">
      {view.tasks.length > 0 && <ExportTaskCards tasks={view.tasks} />}
      {/* The log window is UNCONDITIONAL: while the panel exists (any live
          run — pending, either leg, adopted) the window stands, empty until
          lines arrive. States without a feed used to drop it (the pending
          stretch before the Runner claims, the Daz→Houdini baton moment),
          and a working pipeline with no log window reads as broken. */}
      <ExportActivityLog log={view.log ?? { lines: [] }} />
      {view.bars && (
        <div className="col-start-2 row-start-2 flex min-w-0 flex-col gap-1.5">
          {view.bars.overall && <ProgressBar bar={view.bars.overall} emphasis />}
          <ProgressBar bar={view.bars.current} />
        </div>
      )}
    </div>
  )
}
