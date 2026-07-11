import { romTimelineLength } from '@dth/rom'

import type { RomSection, TimelineSegment } from '@dth/rom'

// Preset blocks get fixed hues; each custom section a stable hue of its own, so
// adjacent blocks stay distinguishable at a glance.
const KIND_BG: Record<TimelineSegment['kind'], string> = {
  base: 'bg-neutral-500',
  dk: 'bg-fuchsia-700',
  gp: 'bg-amber-600',
  phys: 'bg-sky-700',
  custom: 'bg-primary',
}
const SECTION_BG: Record<RomSection, string> = {
  RET: 'bg-slate-600',
  JCM: 'bg-indigo-600',
  FAC: 'bg-teal-600',
  EXP: 'bg-emerald-600',
  GEN: 'bg-rose-600',
  PHY: 'bg-cyan-700',
  FBM: 'bg-violet-600',
  MISC: 'bg-orange-600',
}

function colorFor(seg: TimelineSegment): string {
  return seg.kind === 'custom' && seg.section ? SECTION_BG[seg.section] : KIND_BG[seg.kind]
}

/**
 * A proportional strip of the ROM's frame layout — the measured preset blocks
 * (base ROM, GP/DK, Physics) then each enabled custom section, each sized to its
 * frame count and labelled with its range. Driven by `romTimeline` (the same
 * frame math as generation), so it shows exactly what ships. Makes the
 * frame-alignment invariant tangible and surfaces config mistakes (a section
 * that lands where you didn't expect, or a suspiciously long/short block).
 */
export function RomTimeline({ segments }: { segments: Array<TimelineSegment> }) {
  const total = romTimelineLength(segments)
  if (total === 0) return null
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-muted-foreground">ROM timeline</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {total} frame{total === 1 ? '' : 's'}
        </span>
      </div>
      <div className="flex h-7 w-full overflow-hidden rounded-md border">
        {segments.map((seg) => (
          <div
            key={`${seg.kind}-${seg.start}`}
            className={`flex items-center justify-center overflow-hidden border-r border-black/20 px-1 text-[10px] font-medium text-white/95 last:border-r-0 ${colorFor(seg)}`}
            style={{ width: `${(seg.count / total) * 100}%`, minWidth: '3px' }}
            title={`${seg.label} — frames ${seg.start}–${seg.end} (${seg.count})`}
          >
            <span className="truncate">{seg.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {segments.map((seg) => (
          <span key={`lg-${seg.kind}-${seg.start}`} className="inline-flex items-center gap-1">
            <span className={`inline-block size-2 shrink-0 rounded-sm ${colorFor(seg)}`} />
            {seg.label}{' '}
            <span className="tabular-nums">
              {seg.start === seg.end ? seg.start : `${seg.start}–${seg.end}`}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
