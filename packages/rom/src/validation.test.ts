import { describe, expect, it } from 'vitest'

import { defaultSections } from './types'
import { romValidationErrors } from './validation'

import type { RomGroup, RomPose, RomSection, RomSections } from './types'

function pose(name: string, props: Array<string>): RomPose {
  return {
    id: `pose-${name}-${props.join('|')}`,
    name,
    morphs: props.map((prop, index) => ({ id: `m-${name}-${index}`, node: 'Genesis9', prop, value: 1 })),
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
      { ...group([pose('KneeBend', ['thigh_l'])]), id: 'gl', suffix: 'left', label: 'thigh_l' },
      { ...group([pose('KneeBend', ['thigh_r'])]), id: 'gr', suffix: 'right', label: 'thigh_r' },
    ]
    // The group suffix appends _l/_r to the Unreal morph name — no collision.
    expect(romValidationErrors(s)).toEqual([])
  })

  it('flags a cross-scope collision — a centre `Smile_l` and a left `Smile` both resolve to Smile_l', () => {
    const s = defaultSections()
    for (const key of Object.keys(s) as Array<RomSection>) s[key].enabled = false
    s.JCM.enabled = true
    s.JCM.mode = 'custom'
    s.JCM.groups = [
      { ...group([pose('Smile_l', ['head_bs_SmileL'])]), id: 'gc', suffix: 'centre', label: 'head' },
      { ...group([pose('Smile', ['head_bs_Smile'])]), id: 'gl', suffix: 'left', label: 'head' },
    ]
    const errs = romValidationErrors(s)
    expect(errs).toHaveLength(1)
    expect(errs[0].message).toMatch(/Smile_l/)
  })

  it('never errors on preset sections (nothing to fill in)', () => {
    const s = defaultSections()
    for (const key of Object.keys(s) as Array<RomSection>) s[key].enabled = false
    s.JCM.enabled = true
    s.JCM.mode = 'preset'
    expect(romValidationErrors(s)).toEqual([])
  })
})

describe('romValidationErrors — section-level config errors', () => {
  it('flags FAC preset without a JCM base ROM (the FAC frames live inside the base)', () => {
    const s = defaultSections()
    for (const key of Object.keys(s) as Array<RomSection>) s[key].enabled = false
    s.FAC.enabled = true
    s.FAC.mode = 'preset'
    const errs = romValidationErrors(s)
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({
      section: 'FAC',
      field: 'config',
      groupId: '',
      poseId: '',
      relativeFrame: -1,
    })
    expect(errs[0].message).toMatch(/JCM base/i)
    // Config errors come FIRST — before any frame-positioned cell error.
    s.FBM.enabled = true
    s.FBM.mode = 'custom'
    s.FBM.groups = [group([pose('', ['ok'])])]
    expect(romValidationErrors(s).map((e) => e.field)).toEqual(['config', 'name'])
  })

  it('accepts FAC preset when JCM provides a base (preset OR a custom base .duf)', () => {
    const s = defaultSections()
    for (const key of Object.keys(s) as Array<RomSection>) s[key].enabled = false
    s.FAC.enabled = true
    s.FAC.mode = 'preset'
    s.JCM.enabled = true
    s.JCM.mode = 'preset'
    expect(romValidationErrors(s)).toEqual([])
    s.JCM.mode = 'custom'
    s.JCM.customAssetPath = 'D:/lib/My Base.duf'
    expect(romValidationErrors(s)).toEqual([])
    // Custom JCM WITHOUT a base .duf is not a base ROM — flagged again.
    s.JCM.customAssetPath = '   '
    expect(romValidationErrors(s).map((e) => e.field)).toEqual(['config'])
  })
})

describe('romValidationErrors — group driver-bone labels (the CSV bones column)', () => {
  const withGroup = (section: RomSection, label: string) => {
    const s = defaultSections()
    for (const key of Object.keys(s) as Array<RomSection>) s[key].enabled = false
    s[section].enabled = true
    s[section].mode = 'custom'
    s[section].groups = [{ ...group([pose('Bend', ['prop_a'])]), label }]
    return s
  }

  it('flags an empty label on JCM and PHY custom groups (once per group)', () => {
    for (const section of ['JCM', 'PHY'] as const) {
      const errs = romValidationErrors(withGroup(section, '  '))
      expect(errs).toHaveLength(1)
      expect(errs[0]).toMatchObject({ section, field: 'label', groupId: 'g', poseId: '' })
      expect(errs[0].message).toMatch(/driver bone/i)
      expect(romValidationErrors(withGroup(section, 'thigh_l'))).toEqual([])
    }
  })

  it('does not require a label on GEN groups (the ground-truth GP template ships label-less ones)', () => {
    expect(romValidationErrors(withGroup('GEN', ''))).toEqual([])
  })

  it('does not flag an EMPTY JCM group (it emits no rows at all)', () => {
    const s = defaultSections()
    for (const key of Object.keys(s) as Array<RomSection>) s[key].enabled = false
    s.JCM.enabled = true
    s.JCM.mode = 'custom'
    s.JCM.groups = [group([])]
    expect(romValidationErrors(s)).toEqual([])
  })
})

describe('romValidationErrors — art-direction morph names', () => {
  const withArtDirection = (prop: string) => {
    const s = defaultSections()
    for (const key of Object.keys(s) as Array<RomSection>) s[key].enabled = false
    s.GEN.enabled = true
    s.GEN.mode = 'preset'
    s.GEN.artDirection = [
      {
        id: 'ad1',
        rom: 'gp',
        frame: 100,
        name: 'AnusOpen',
        morphs: [{ id: 'adm1', node: 'GoldenPalace_G9', prop, value: 0.9 }],
      },
    ]
    return s
  }

  it('flags an empty art-direction morph name (it feeds the runtime verbatim)', () => {
    const errs = romValidationErrors(withArtDirection('   '))
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({
      section: 'GEN',
      field: 'morphName',
      poseId: 'ad1',
      morphIndex: 0,
      relativeFrame: -1,
    })
    expect(errs[0].message).toMatch(/AnusOpen/)
    expect(romValidationErrors(withArtDirection('GP9_Anus_Open'))).toEqual([])
  })

  it('ignores art direction when GEN is custom/disabled (it only ships with the preset)', () => {
    const s = withArtDirection('')
    s.GEN.mode = 'custom'
    expect(romValidationErrors(s)).toEqual([])
  })
})

describe('romValidationErrors — reserved (template-baked) pose names', () => {
  it('flags a custom pose that resolves to a name the preset ROM already exports', () => {
    const s = customSection('FBM', [pose('Fence01', ['body_bs_X'])])
    const errs = romValidationErrors(s, ['Fence01'])
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ section: 'FBM', field: 'name', relativeFrame: 0 })
    expect(errs[0].message).toMatch(/preset ROM/i)
    // Without the reservation the same pose is fine.
    expect(romValidationErrors(s)).toEqual([])
  })

  it('matches on the RESOLVED name — a left-group pose collides with a reserved _l name', () => {
    const s = defaultSections()
    for (const key of Object.keys(s) as Array<RomSection>) s[key].enabled = false
    s.EXP.enabled = true
    s.EXP.mode = 'custom'
    s.EXP.groups = [{ ...group([pose('BallBD40', ['prop_a'])]), suffix: 'left' }]
    expect(romValidationErrors(s, ['BallBD40_l'])).toHaveLength(1)
    expect(romValidationErrors(s, ['BallBD40'])).toEqual([])
  })
})
