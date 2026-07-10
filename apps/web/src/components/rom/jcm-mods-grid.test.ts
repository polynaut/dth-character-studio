import { describe, expect, it } from 'vitest'

import type { JcmMorphMod } from '@dth/rom'

import { mirrorMod, mirrorSide } from './jcm-mods-grid.tsx'

describe('mirrorSide', () => {
  it('flips Left/Right words, preserving case', () => {
    expect(mirrorSide('Left Thigh Bend')).toBe('Right Thigh Bend')
    expect(mirrorSide('Right Thigh Bend')).toBe('Left Thigh Bend')
    expect(mirrorSide('LEFT arm')).toBe('RIGHT arm')
    expect(mirrorSide('left foot')).toBe('right foot')
  })

  it('flips a separator-led single side letter, preserving case', () => {
    expect(mirrorSide('Hip Adjuster L')).toBe('Hip Adjuster R')
    expect(mirrorSide('Hip Adjuster R')).toBe('Hip Adjuster L')
    expect(mirrorSide('body_l_calf')).toBe('body_r_calf')
    expect(mirrorSide('body-r-shin')).toBe('body-l-shin')
    expect(mirrorSide('shin_l')).toBe('shin_r')
  })

  it('leaves side-less names (shared centre controllers) untouched', () => {
    expect(mirrorSide('!Hip Bend Controller')).toBe('!Hip Bend Controller')
    expect(mirrorSide('!Leg Bend Controller')).toBe('!Leg Bend Controller')
    // "l"/"r" inside a word (not after a separator) must not flip.
    expect(mirrorSide('body_bs_CalfFlex')).toBe('body_bs_CalfFlex')
  })

  it('does not double-flip (Left -> Right stays Right)', () => {
    expect(mirrorSide(mirrorSide('Left Thigh Bend'))).toBe('Left Thigh Bend')
  })
})

describe('mirrorMod', () => {
  it('mirrors the bone label + morph names but copies axis/angles/values verbatim', () => {
    // The user's real "Left Thigh Bend" example (from modifyJcmRom.dsa).
    const left: JcmMorphMod = {
      boneLabel: 'Left Thigh Bend',
      axis: 'XRotate',
      positive: [
        {
          morphName: '!Hip Bend Controller',
          range: { angle: { start: 0, end: 37.5 }, value: { start: 1, end: 1 } },
        },
      ],
      negative: [
        {
          morphName: 'Hip Adjuster L',
          range: { angle: { start: 0, end: -115 }, value: { start: 0, end: 1 } },
        },
      ],
    }
    const right = mirrorMod(left)
    expect(right.boneLabel).toBe('Right Thigh Bend')
    expect(right.axis).toBe('XRotate')
    // Side-less controller unchanged; the L-suffixed morph flips to R.
    expect(right.positive[0].morphName).toBe('!Hip Bend Controller')
    expect(right.negative[0].morphName).toBe('Hip Adjuster R')
    // Angles/values are copied verbatim (no negation).
    expect(right.positive[0].range).toEqual({ angle: { start: 0, end: 37.5 }, value: { start: 1, end: 1 } })
    expect(right.negative[0].range).toEqual({ angle: { start: 0, end: -115 }, value: { start: 0, end: 1 } })
  })

  it('deep-copies ranges (no shared references with the source)', () => {
    const src: JcmMorphMod = {
      boneLabel: 'Left Foot',
      axis: 'YRotate',
      positive: [
        { morphName: 'x', range: { angle: { start: 0, end: 30 }, value: { start: 0, end: 1 } } },
      ],
      negative: [],
    }
    const out = mirrorMod(src)
    out.positive[0].range.angle.end = 999
    expect(src.positive[0].range.angle.end).toBe(30)
  })
})
