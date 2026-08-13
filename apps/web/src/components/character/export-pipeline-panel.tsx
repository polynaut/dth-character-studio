import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

import { cn } from '@dth/ui'

/**
 * The header's live DTH-Export pipeline display: a narrow task-card column
 * (every Daz scene of the selection, then every Houdini project, then every
 * Unreal project the export is handed to — the chronological order the run
 * works through) beside the tail-mode log window.
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
  kind: 'daz' | 'houdini' | 'unreal'
  status: 'waiting' | 'active' | 'done'
}

export interface ExportProgressBar {
  /** 0–100. */
  percent: number
  /** What the CURRENT bar is measuring right now. Nothing renders it — see
   *  `ProgressBar` — it survives as the step's identity, and a change in it is
   *  what restarts `sinceMs`. Optional, and deliberately absent on the OVERALL
   *  bar: that one keys no clock, so a "Scenes 0/2" nobody reads would just be
   *  the removed caption still being computed. */
  label?: string
  /** Which leg the bar measures — the fill wears that kind's color, the same
   *  identity the task cards carry. */
  kind: 'daz' | 'houdini'
  /** When the CURRENT step began (first seen). The button's own clock shows
   *  the run's total; this is per STEP, kept on the view for whoever wants to
   *  surface a minutes-long silent stretch. */
  sinceMs?: number
}

export interface ExportPipelineView {
  /** Task cards, chronological. Empty for an adopted run (no identity). */
  tasks: Array<ExportTask>
  /** The live log-window content — whichever leg is talking right now. Lines
   *  only: the scene lives on the active task card and the percent on the
   *  meter, so the window carries no caption row — and the newest line in it
   *  IS the status, which is why the meters carry no text of their own. */
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
  const bar =
    task.kind === 'daz'
      ? 'bg-emerald-500'
      : task.kind === 'houdini'
        ? 'bg-orange-500'
        : 'bg-unreal-blue'
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
    // flex-col-REVERSE: the queue falls to the bottom, tetris-style — the card
    // being worked sits at the very bottom (where the eye already is, beside
    // the buttons) and everything still to come stacks above it. DOM order
    // stays chronological, so the numbering and the exit animation are
    // unchanged; only the visual stacking flips.
    <div className="col-start-1 row-start-1 row-span-2 flex min-h-0 w-44 shrink-0 flex-col-reverse justify-start gap-1 border-r border-border/70 pr-3">
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
              // The 5th live card is the TOPMOST one now (the column is
              // reversed), so it fades upward, away from the active card.
              position === 4 &&
                !isCollapsed &&
                '[mask-image:linear-gradient(to_top,#000_0%,transparent_90%)]',
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

/** Lead the MESSAGE with a capital, leaving the `[HH:MM:SS] ` stamp alone —
 *  the raw log speaks lowercase ("opening scene"), the window is a caption. */
function capitalizeLine(line: string): string {
  return line.replace(/^(\[[^\]]*\]\s*)?(.)/, (_, stamp: string | undefined, first: string) => {
    return (stamp ?? '') + first.toUpperCase()
  })
}

export function ExportActivityLog({ log }: { log: { lines: Array<string> } }) {
  const boxRef = useRef<HTMLDivElement>(null)
  // Tail mode: whenever lines arrive, keep the newest one in view.
  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [log.lines])
  return (
    // The grid places this in the buttons' shared column, so its width IS
    // theirs. The box alone: the newest line IS the status, so a headline
    // repeating it was the same words twice.
    // justify-end: the box sits at the BOTTOM of its cell, right above the
    // meter — the run's most recent word as close to the buttons as possible.
    <div className="col-start-2 row-start-1 flex min-h-0 min-w-0 flex-col justify-end text-left">
      <div
        data-export-log
        ref={boxRef}
        // A CONSTANT height, deliberately: the header's own height is
        // content-driven, so a content-sized log inflated the whole header as
        // lines arrived (and jumped per line). Fixed box + tail scroll — the
        // newest lines stay in view, the layout never moves.
        // 5 lines exactly: h-20 = 80px at leading-4 (16px per line).
        className="flex h-20 flex-col overflow-y-auto rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap break-all text-muted-foreground"
      >
        {/* mt-auto, not justify-end: a flex scroll container with justify-end
            clips its first lines once the content overflows. This pins a SHORT
            log to the bottom (terminal-style) and scrolls normally when full. */}
        <div className="mt-auto">
          {log.lines.map((line, index) => (
            // Index keys are sound here: the list is an append-only rolling tail.
            // eslint-disable-next-line react/no-array-index-key
            <div key={index}>{capitalizeLine(line)}</div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** One progress meter. The fill wears the LEG's color (the entity, like its
 *  cards); every text stays in muted ink. `emphasis` = the overall (top) bar
 *  of a two-level display, slightly taller. */
function ProgressBar({ bar, emphasis = false }: { bar: ExportProgressBar; emphasis?: boolean }) {
  const percent = Math.min(100, Math.max(0, bar.percent))
  // NEITHER bar carries text: the row is the track and its number. The current
  // bar's status is the newest line in the log window, and the overall bar's
  // "Scenes 0/2" was the numbered task-card column said a second time — the
  // cards ARE the queue, and dropping the label lets both tracks start at the
  // same left edge instead of one being indented by its own caption.
  //
  // It moves to ARIA rather than vanishing: the visible caption was the only
  // thing naming these meters, so dropping it outright would leave a screen
  // reader two anonymous percentages. `progressbar` + a name + the value is
  // what the sighted reader gets from the track, said out loud.
  return (
    <div
      role="progressbar"
      aria-label={emphasis ? 'Overall progress' : 'Current step progress'}
      aria-valuenow={Math.round(percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      data-progressbar={emphasis ? 'overall' : 'current'}
      data-percent={Math.round(percent)}
      className="flex items-center gap-2"
    >
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
