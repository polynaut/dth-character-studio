import { describe, expect, it } from 'vitest'

import { defaultSections } from './types'
import { romValidationErrors } from './validation'

import type { RomGroup, RomPose, RomSection, RomSections } from './types'

function pose(name: string, props: Array<string>): RomPose {
  return {
    id: `pose-${name}-${props.join('|')}`,
    name,
    morphs: props.map((prop) => ({ node: 'Genesis9', prop, value: 1 })),
    boneScaleRef: false,
  }
}

function group(poses: Array<RomPose>): RomGroup {
  return { id: 'g', label: '', suffix: 'centre', method: 'individual', calculateFrom: 'default', poses }
}

function customSection(section: RomSection, poses: Array<RomPose>): RomSections {
  const s = defaultSections()
  for (const key of Object.keys(s) as Array<RomSection>) s[key].enabled = false
  s[section].enabled = true
  s[section].mode = 'custom'
  s[section].groups = [group(poses)]
  return s
}

describe('romValidationErrors', () => {
  it('passes a fully-filled custom pose', () => {
    const s = customSection('FBM', [pose('BodyTone', ['body_bs_BodyTone'])])
    expect(romValidationErrors(s)).toEqual([])
  })

  it('flags an empty pose name', () => {
    const s = customSection('FBM', [pose('', ['body_bs_BodyTone'])])
    const errs = romValidationErrors(s)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ section: 'FBM', field: 'name', relativeFrame: 0 })
  })

  it('flags a pose name with characters Houdini rejects (spaces, punctuation)', () => {
    const s = customSection('FBM', [pose('Body Tone', ['body_bs_BodyTone'])])
    const errs = romValidationErrors(s)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ section: 'FBM', field: 'name', relativeFrame: 0 })
    expect(errs[0].message).toMatch(/Houdini rejects/)
  })

  it('accepts underscores in a pose name', () => {
    const s = customSection('FBM', [pose('Body_Tone_2', ['body_bs_BodyTone'])])
    expect(romValidationErrors(s)).toEqual([])
  })

  it('flags an empty (or whitespace) morph name', () => {
    const s = customSection('FBM', [pose('BodyTone', ['   '])])
    const errs = romValidationErrors(s)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ field: 'morphName', morphIndex: 0 })
  })

  it('flags a pose with no morphs', () => {
    const s = customSection('FBM', [pose('BodyTone', [])])
    const errs = romValidationErrors(s)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ field: 'morphName', morphIndex: 0 })
  })

  it('reports errors in frame order — errors[0] is the first on the timeline', () => {
    const s = customSection('FBM', [
      pose('Good', ['ok']),
      pose('', ['also_ok']), // frame 1: empty name
      pose('Third', ['']), // frame 2: empty morph
    ])
    const errs = romValidationErrors(s)
    expect(errs.map((e) => [e.relativeFrame, e.field])).toEqual([
      [1, 'name'],
      [2, 'morphName'],
    ])
  })

  it('flags duplicate pose names within the same suffix scope (same Unreal morph)', () => {
    const s = customSection('FBM', [
      pose('BodyTone', ['body_bs_BodyTone']),
      pose('BodyTone', ['body_bs_BodyToneAlt']), // frame 1: collides with frame 0
    ])
    const errs = romValidationErrors(s)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ field: 'name', relativeFrame: 1 })
    expect(errs[0].message).toMatch(/duplicate/i)
  })

  it('allows the same pose name across DIFFERENT suffixes (left/right variants)', () => {
    const s = defaultSections()
    for (const key of Object.keys(s) as Array<RomSection>) s[key].enabled = false
    s.JCM.enabled = true
    s.JCM.mode = 'custom'
    s.JCM.groups = [
      { ...group([pose('KneeBend', ['thigh_l'])]), id: 'gl', suffix: 'left' },
      { ...group([pose('KneeBend', ['thigh_r'])]), id: 'gr', suffix: 'right' },
    ]
    // The group suffix appends _l/_r to the Unreal morph name — no collision.
    expect(romValidationErrors(s)).toEqual([])
  })

  it('never errors on preset sections (nothing to fill in)', () => {
    const s = defaultSections()
    for (const key of Object.keys(s) as Array<RomSection>) s[key].enabled = false
    s.JCM.enabled = true
    s.JCM.mode = 'preset'
    expect(romValidationErrors(s)).toEqual([])
  })
})
