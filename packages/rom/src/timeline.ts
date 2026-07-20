import { customSections, jcmIsBaseRom, presetFrameCount, presetSelections } from './frames.ts'
import { SECTION_LABELS } from './types.ts'
import type { PresetFrames } from './frames.ts'
import type { Gender, RomSection, RomSections } from './types.ts'

/** A contiguous block of the ROM timeline — a 0-based, inclusive frame range. */
export interface TimelineSegment {
  kind: 'base' | 'dk' | 'gp' | 'phys' | 'custom'
  /** The section this block is — set only for a 'custom' block (the preset
   *  blocks each span several sections, e.g. the base ROM is RET+JCM+FAC). */
  section?: RomSection
  label: string
  /** First frame (0-based, inclusive). */
  start: number
  /** Last frame (inclusive). */
  end: number
  count: number
}

/**
 * The ROM timeline as an ordered list of frame blocks: the measured preset ROM
 * blocks (base ROM, then Dicktator / Golden Palace when included, then Physics),
 * followed by each enabled **custom** section in canonical order. It's driven by
 * the SAME frame math as generation — the preset offsets sum exactly to
 * {@link presetFrameCount} and the custom blocks continue from there — so what it
 * visualises is exactly what ships to Daz and Houdini. Empty (0-pose) custom
 * sections are omitted. Requires measured {@link PresetFrames}.
 */
export function romTimeline(
  sections: RomSections,
  gender: Gender,
  frames: PresetFrames,
): Array<TimelineSegment> {
  const segments: Array<TimelineSegment> = []
  let cursor = 0
  const add = (kind: TimelineSegment['kind'], label: string, count: number) => {
    if (count <= 0) return
    segments.push({ kind, label, start: cursor, end: cursor + count - 1, count })
    cursor += count
  }

  // Preset blocks, in the order the Daz runtime lays them on the timeline.
  if (jcmIsBaseRom(sections)) add('base', 'Base ROM', frames.base)
  const { includeGp, includeDk, physPreset } = presetSelections(sections, gender)
  if (includeDk) add('dk', 'Dicktator', frames.dk)
  if (includeGp) add('gp', 'Golden Palace', frames.gp)
  if (physPreset) add('phys', 'Physics', frames.phys)

  // The custom sequence continues at the generated offset. Pin it to the single
  // source (presetFrameCount) rather than the accumulated cursor — they are equal
  // by construction (a test asserts it), and this can't drift from generation.
  let custom = presetFrameCount(sections, gender, frames)
  for (const { section, config } of customSections(sections)) {
    const count = config.groups.reduce((sum, group) => sum + group.poses.length, 0)
    if (count === 0) continue
    segments.push({
      kind: 'custom',
      section,
      label: SECTION_LABELS[section],
      start: custom,
      end: custom + count - 1,
      count,
    })
    custom += count
  }
  return segments
}

/** Total ROM length in frames (one past the last segment's end, or 0 if empty). */
export function romTimelineLength(segments: Array<TimelineSegment>): number {
  return segments.length === 0 ? 0 : segments[segments.length - 1].end + 1
}
