import { describe, expect, it } from 'vitest'

import { defaultSections, presetFrameCount } from './types'
import { romTimeline, romTimelineLength } from './timeline'

import type { PresetFrames, RomGroup, RomSection, RomSections } from './types'

// The validated DTH G9 preset-block lengths (measured, not hard-coded).
const FRAMES: PresetFrames = { base: 328, gp: 104, dk: 54, phys: 43 }

function group(nPoses: number): RomGroup {
  return {
    id: 'g',
    label: '',
    suffix: 'centre',
    method: 'individual',
    calculateFrom: 'default',
    poses: Array.from({ length: nPoses }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      morphs: [],
      boneScaleRef: false,
    })),
  }
}

/** Base sections defaulted OFF, so each test opts into exactly the blocks it wants. */
function sections(patch: (s: RomSections) => void): RomSections {
  const s = defaultSections()
  for (const key of Object.keys(s) as Array<RomSection>) {
    s[key].enabled = false
    s[key].mode = 'custom'
  }
  patch(s)
  return s
}

describe('romTimeline', () => {
  it('shows the base ROM block for a preset base', () => {
    const s = sections((s) => {
      s.JCM.enabled = true
      s.JCM.mode = 'preset'
    })
    const t = romTimeline(s, 'female', FRAMES)
    expect(t).toEqual([{ kind: 'base', label: 'Base ROM', start: 0, end: 327, count: 328 }])
    expect(romTimelineLength(t)).toBe(328)
  })

  it('continues a custom section right after the base ROM', () => {
    const s = sections((s) => {
      s.JCM.enabled = true
      s.JCM.mode = 'preset'
      s.EXP.enabled = true
      s.EXP.mode = 'custom'
      s.EXP.groups = [group(5)]
    })
    const t = romTimeline(s, 'female', FRAMES)
    expect(t[0]).toMatchObject({ kind: 'base', start: 0, end: 327 })
    expect(t[1]).toMatchObject({ kind: 'custom', section: 'EXP', start: 328, end: 332, count: 5 })
    expect(romTimelineLength(t)).toBe(333)
  })

  it('lays base -> Golden Palace -> custom in order (female GP)', () => {
    const s = sections((s) => {
      s.JCM.enabled = true
      s.JCM.mode = 'preset'
      s.GEN.enabled = true
      s.GEN.mode = 'preset'
      s.FBM.enabled = true
      s.FBM.mode = 'custom'
      s.FBM.groups = [group(3)]
    })
    const t = romTimeline(s, 'female', FRAMES)
    expect(t.map((seg) => seg.kind)).toEqual(['base', 'gp', 'custom'])
    expect(t[1]).toMatchObject({ kind: 'gp', start: 328, end: 431, count: 104 })
    expect(t[2]).toMatchObject({ kind: 'custom', section: 'FBM', start: 432 })
  })

  it('places the first custom pose at frame 0 when there is no preset block', () => {
    const s = sections((s) => {
      s.EXP.enabled = true
      s.EXP.mode = 'custom'
      s.EXP.groups = [group(4)]
    })
    const t = romTimeline(s, 'female', FRAMES)
    expect(t).toEqual([
      { kind: 'custom', section: 'EXP', label: 'Expressions', start: 0, end: 3, count: 4 },
    ])
  })

  it('omits empty (0-pose) custom sections', () => {
    const s = sections((s) => {
      s.JCM.enabled = true
      s.JCM.mode = 'preset'
      s.EXP.enabled = true
      s.EXP.mode = 'custom'
      s.EXP.groups = [group(0)]
    })
    const t = romTimeline(s, 'female', FRAMES)
    expect(t).toEqual([{ kind: 'base', label: 'Base ROM', start: 0, end: 327, count: 328 }])
  })

  it('INVARIANT: preset blocks sum to presetFrameCount, and custom starts there', () => {
    // A rich config: base + GP + Physics presets, then two custom sections.
    const s = sections((s) => {
      s.JCM.enabled = true
      s.JCM.mode = 'preset'
      s.GEN.enabled = true
      s.GEN.mode = 'preset'
      s.PHY.enabled = true
      s.PHY.mode = 'preset'
      s.EXP.enabled = true
      s.EXP.mode = 'custom'
      s.EXP.groups = [group(2)]
      s.FBM.enabled = true
      s.FBM.mode = 'custom'
      s.FBM.groups = [group(6)]
    })
    const t = romTimeline(s, 'female', FRAMES)
    const presetCount = presetFrameCount(s, 'female', FRAMES)
    const presetSegments = t.filter((seg) => seg.kind !== 'custom')
    const presetSum = presetSegments.reduce((n, seg) => n + seg.count, 0)
    // The measured preset blocks must sum to exactly the generated offset...
    expect(presetSum).toBe(presetCount)
    // ...and the first custom segment must start at that offset (== generation).
    const firstCustom = t.find((seg) => seg.kind === 'custom')
    expect(firstCustom?.start).toBe(presetCount)
    // Sections stay contiguous — no gaps, no overlaps.
    for (let i = 1; i < t.length; i++) expect(t[i].start).toBe(t[i - 1].end + 1)
  })
})
