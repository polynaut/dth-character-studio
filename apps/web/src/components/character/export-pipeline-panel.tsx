import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

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
  /** 1-based position in the REMAINING queue: a finished card's slot collapses
   *  and everything behind it moves up a number, so the top card is always
   *  "1." and the column reads as what is still to do. (The alternative —
   *  fixed run-order numbers — leaves a lone "2." standing at the end.) */
  ordinal: number
  departing: boolean
}) {
  const active = task.status === 'active' || departing
  // The kind's color rides a left BAR and a status dot — the card itself stays
  // a surface, so a queue of them reads as a list instead of a row of paint.
  const bar = task.kind === 'daz' ? 'bg-emerald-500' : 'bg-orange-500'
  return (
    <div
      data-task={task.id}
      data-task-status={departing ? 'done' : task.status}
      className={cn(
        'relative flex items-center gap-2 overflow-hidden rounded-md pr-1.5 pl-3 text-xs transition-all',
        active
          ? 'bg-accent font-semibold text-foreground'
          : 'bg-card/60 font-medium text-muted-foreground',
        departing && 'translate-x-28 translate-y-12 rotate-6 opacity-0',
      )}
      style={{ transitionDuration: `${FLY_MS}ms` }}
      title={task.detail ? `${task.label}\n${task.detail}` : task.label}
    >
      {/* The accent bar: full-height on the active card, a hairline behind. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-[3px] rounded-full transition-opacity',
          bar,
          active ? 'opacity-100' : 'opacity-40',
        )}
      />
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', bar, !active && 'opacity-50')}
      />
      <span className="shrink-0 tabular-nums opacity-60">{ordinal}.</span>
      <span className="truncate py-1.5">{task.label}</span>
      <ChevronRight className="ml-auto size-3.5 shrink-0 opacity-30" />
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
    // A tiny separator line marks the queue off from the log window.
    <div className="col-start-1 row-start-1 row-span-2 flex min-h-0 w-44 shrink-0 flex-col gap-1 border-r border-border/70 pr-3">
      {tasks.map((task) => {
        const isFlying = flying.has(task.id)
        const isCollapsed = collapsed.has(task.id)
        // Position among the LIVE slots — so the number and the slide happen
        // in the same frame (a card mid-flight still holds its slot, and its
        // number with it).
        const position = visibleIds.indexOf(task.id)
        const hidden = isCollapsed || position >= 5
        return (
          <div
            key={task.id}
            className={cn(
              'transition-all',
              hidden ? 'max-h-0 opacity-0' : 'max-h-10',
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
            <ExportTaskCard task={task} ordinal={Math.max(position, 0) + 1} departing={isFlying} />
          </div>
        )
      })}
    </div>
  )
}

/**
 * The run's current status, as the panel's headline — the one line worth
 * reading at a glance, with the per-step clock beside it so a minutes-long
 * silent step is visibly ticking rather than frozen.
 */
function StatusHeadline({ headline }: { headline: { text: string; sinceMs?: number } }) {
  // Ticks on its own: the poll only moves at step boundaries, and the whole
  // point is showing life BETWEEN them.
  const [, tick] = useState(0)
  useEffect(() => {
    if (headline.sinceMs === undefined) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [headline.sinceMs])
  const text = headline.text.charAt(0).toUpperCase() + headline.text.slice(1)
  return (
    <p data-status-headline className="mb-1.5 flex items-baseline gap-2 text-sm">
      <span className="truncate font-semibold text-foreground">{text}</span>
      {headline.sinceMs !== undefined && (
        <>
          <span aria-hidden className="text-border">
            |
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatClock(Date.now() - headline.sinceMs)}
          </span>
        </>
      )}
    </p>
  )
}

/** Lead the MESSAGE with a capital, leaving the `[HH:MM:SS] ` stamp alone —
 *  the raw log speaks lowercase ("opening scene"), the window is a caption. */
function capitalizeLine(line: string): string {
  return line.replace(/^(\[[^\]]*\]\s*)?(.)/, (_, stamp: string | undefined, first: string) => {
    return (stamp ?? '') + first.toUpperCase()
  })
}

export function ExportActivityLog({
  log,
  headline,
}: {
  log: { lines: Array<string> }
  /** The run's current status, shown as the panel's own headline (the meter
   *  under it then carries the percent alone) — plus its per-step clock. */
  headline?: { text: string; sinceMs?: number }
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  // Tail mode: whenever lines arrive, keep the newest one in view.
  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [log.lines])
  return (
    // The grid places this in the buttons' shared column, so its width IS
    // theirs. Headline + captioned log box; the meters sit below.
    <div className="col-start-2 row-start-1 flex min-h-0 min-w-0 flex-col text-left">
      {headline && <StatusHeadline headline={headline} />}
      <p className="mb-1 text-[10px] tracking-wide text-muted-foreground/70 uppercase">
        Activity log
      </p>
      <div
        data-export-log
        ref={boxRef}
        // A CONSTANT height, deliberately: the header's own height is
        // content-driven, so a content-sized log inflated the whole header as
        // lines arrived (and jumped per line). Fixed box + tail scroll — the
        // newest lines stay in view, the layout never moves.
        // 5 lines exactly: h-20 = 80px at leading-4 (16px per line).
        className="h-20 overflow-y-auto rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap break-all text-muted-foreground"
      >
        {log.lines.map((line, index) => (
          // Index keys are sound here: the list is an append-only rolling tail.
          // eslint-disable-next-line react/no-array-index-key
          <div key={index}>{capitalizeLine(line)}</div>
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
  // The CURRENT bar's status is the headline above the log, so this row is the
  // track and its number. The OVERALL bar keeps a label — it counts a
  // different thing (scenes / networks) and nothing else says so.
  const label = bar.label.charAt(0).toUpperCase() + bar.label.slice(1)
  return (
    <div
      data-progressbar={emphasis ? 'overall' : 'current'}
      data-percent={Math.round(percent)}
      className="flex items-center gap-2"
    >
      {emphasis && (
        <span className="shrink-0 truncate text-[11px] text-muted-foreground">{label}</span>
      )}
      <div
        className={cn(
          'min-w-0 flex-1 overflow-hidden rounded-full bg-muted',
          emphasis ? 'h-1.5' : 'h-1',
        )}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            bar.kind === 'daz' ? 'bg-emerald-500' : 'bg-orange-500',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
        {Math.round(percent)}%
      </span>
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
      <ExportActivityLog
        log={view.log ?? { lines: [] }}
        headline={
          view.bars
            ? { text: view.bars.current.label, sinceMs: view.bars.current.sinceMs }
            : undefined
        }
      />
      {view.bars && (
        <div className="col-start-2 row-start-2 flex min-w-0 flex-col gap-1.5">
          {view.bars.overall && <ProgressBar bar={view.bars.overall} emphasis />}
          <ProgressBar bar={view.bars.current} />
        </div>
      )}
    </div>
  )
}
