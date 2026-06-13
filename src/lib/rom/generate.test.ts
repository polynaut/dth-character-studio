import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  generateAll,
  resolveRomPaths,
  toArtDirectionJsons,
  toDazFbmCsv,
  toDazFbmJson,
  toPoseAssetCsv,
  toWorkflowDsa,
} from './generate'
import {
  characterSchema,
  defaultSections,
  flattenRom,
  mirrorGroup,
  sectionsFromFlatFrames,
} from './types'

import type { Character, RomGroup, RomSections } from './types'

function fbmGroup(): RomGroup {
  return {
    id: 'g1',
    label: '',
    suffix: 'centre',
    method: 'individual',
    calculateFrom: 'default',
    poses: [
      {
        id: 'p1',
        name: 'BodyTone',
        morphs: [{ node: 'Genesis9', prop: 'body_bs_BodyTone', value: 1 }],
        referenceFbx: '',
      },
      {
        id: 'p2',
        name: 'Glute UpDown',
        morphs: [{ node: 'Genesis9', prop: 'SS_body_bs_Glute UpDown', value: -1 }],
        referenceFbx: '',
      },
    ],
  }
}

function makeSections(patch: Partial<RomSections> = {}): RomSections {
  const sections = defaultSections()
  sections.FBM.groups = [fbmGroup()]
  return { ...sections, ...patch }
}

function makeCharacter(overrides: Partial<Character> = {}): Character {
  const now = '2026-06-11T00:00:00.000Z'
  return characterSchema.parse({
    id: 'test',
    name: 'Electra G9',
    createdAt: now,
    updatedAt: now,
    sections: makeSections(),
    ...overrides,
  })
}

describe('flattenRom', () => {
  it('numbers frames 1-based across enabled custom sections in canonical order', () => {
    const sections = makeSections()
    sections.EXP.enabled = true
    sections.EXP.groups = [{ ...fbmGroup(), id: 'exp1' }]
    const frames = flattenRom(sections)
    expect(frames.map((f) => [f.frame, f.section, f.name])).toEqual([
      [1, 'EXP', 'BodyTone'],
      [2, 'EXP', 'Glute UpDown'],
      [3, 'FBM', 'BodyTone'],
      [4, 'FBM', 'Glute UpDown'],
    ])
  })

  it('skips disabled and preset sections', () => {
    const sections = makeSections()
    sections.FBM.enabled = false
    expect(flattenRom(sections)).toEqual([])
  })
})

describe('sectionsFromFlatFrames', () => {
  it('groups consecutive same-section runs, enables them and falls back to MISC', () => {
    const sections = sectionsFromFlatFrames([
      { section: 'EXP', name: 'Angry', morphs: [] },
      { section: 'EXP', name: 'Happy', morphs: [] },
      { section: 'FBM', name: 'Heavy', morphs: [] },
      { section: 'whatever', name: 'Odd', morphs: [] },
    ])
    expect(sections.EXP.enabled).toBe(true)
    expect(sections.EXP.mode).toBe('custom')
    expect(sections.EXP.groups).toHaveLength(1)
    expect(sections.EXP.groups[0].poses.map((p) => p.name)).toEqual(['Angry', 'Happy'])
    expect(sections.FBM.groups[0].poses.map((p) => p.name)).toEqual(['Heavy'])
    expect(sections.MISC.enabled).toBe(true)
    expect(sections.MISC.groups[0].poses[0].name).toBe('Odd')
  })
})

describe('mirrorGroup', () => {
  it('clones a left group to right with swapped morph props', () => {
    const left: RomGroup = {
      id: 'gl',
      label: 'MajoraPush',
      suffix: 'left',
      method: 'individual',
    calculateFrom: 'default',
      poses: [
        {
          id: 'pl',
          name: 'MajoraPush1',
          morphs: [{ node: 'Golden Palace', prop: 'GPL_Majora_Push 1_Left', value: 1 }],
          referenceFbx: '',
        },
      ],
    }
    const right = mirrorGroup(left)
    expect(right.suffix).toBe('right')
    expect(right.id).not.toBe(left.id)
    expect(right.poses[0].name).toBe('MajoraPush1')
    expect(right.poses[0].morphs[0].prop).toBe('GPL_Majora_Push 1_Right')
  })
})

describe('toDazFbmJson', () => {
  it('produces the DazToHue-Scripts FBM JSON format with 1-based frames', () => {
    const file = toDazFbmJson(makeCharacter())
    expect(file.fileName).toBe('ElectraG9_FBMs.json')
    const json = JSON.parse(file.content)
    expect(json.meta.version).toBe('1.0')
    expect(json.meta.resetGPBeforeApplying).toBe(true)
    expect(json.frames[0]).toEqual({
      frame: 1,
      section: 'FBM',
      name: 'BodyTone',
      morphs: [{ node: 'Genesis9', prop: 'body_bs_BodyTone', value: 1 }],
    })
    expect(json.frames[1].frame).toBe(2)
  })

  it('keeps base and autoBase morph fields, omitting them when unset', () => {
    const sections = makeSections()
    sections.FBM.groups[0].poses[0].morphs[0] = {
      node: 'GoldenPalace_G9',
      prop: 'GP9_Anus_Depth',
      value: 0.5,
      base: 0.2,
    }
    sections.FBM.groups[0].poses[1].morphs[0] = {
      ...sections.FBM.groups[0].poses[1].morphs[0],
      autoBase: true,
    }
    const json = JSON.parse(toDazFbmJson(makeCharacter({ sections })).content)
    expect(json.frames[0].morphs[0]).toEqual({
      node: 'GoldenPalace_G9',
      prop: 'GP9_Anus_Depth',
      value: 0.5,
      base: 0.2,
    })
    expect(json.frames[1].morphs[0].autoBase).toBe(true)
    expect('base' in json.frames[1].morphs[0]).toBe(false)
  })
})

describe('toDazFbmCsv', () => {
  it('matches the flat CSV format with the empty rest frame at 0', () => {
    const file = toDazFbmCsv(makeCharacter())
    const lines = file.content.trimEnd().split('\n')
    expect(lines[0]).toBe('0,FBM,Empty')
    expect(lines[1]).toBe('1,FBM,BodyTone,Genesis9,body_bs_BodyTone,1')
    expect(lines[2]).toBe('2,FBM,Glute UpDown,Genesis9,SS_body_bs_Glute UpDown,-1')
  })
})

describe('toWorkflowDsa', () => {
  it('derives the include flags from the section configuration', () => {
    const file = toWorkflowDsa(makeCharacter())
    expect(file.fileName).toBe('DthWorkflowElectraG9.dsa')
    // Defaults: JCM/FAC enabled preset, GEN disabled.
    expect(file.content).toContain('options.bIncludeJCM = true;')
    expect(file.content).toContain('options.bIncludeFAC = true;')
    expect(file.content).toContain('options.bIncludeGP = false;')
    expect(file.content).toContain('options.bIncludeDK = false;')
    expect(file.content).toContain('options.bDQS = true;')
    expect(file.content).toContain('dir_self.filePath("ElectraG9_FBMs.json")')
    expect(file.content).toContain('ApplyDTHWorkflow(options);')
    expect(file.content).not.toContain('preserveMorphs')
  })

  it('maps the selected GEN preset assets onto bIncludeGP/bIncludeDK', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    sections.GEN.presetAssets = ['GP9 - Golden Palace.duf', 'DK9 - Dicktator.duf']
    const file = toWorkflowDsa(makeCharacter({ sections }))
    expect(file.content).toContain('options.bIncludeGP = true;')
    expect(file.content).toContain('options.bIncludeDK = true;')
  })

  it('defaults the GEN preset by gender when nothing is selected', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    const female = toWorkflowDsa(makeCharacter({ sections }))
    expect(female.content).toContain('options.bIncludeGP = true;')
    expect(female.content).toContain('options.bIncludeDK = false;')
    const male = toWorkflowDsa(makeCharacter({ sections, gender: 'male' }))
    expect(male.content).toContain('options.bIncludeGP = false;')
    expect(male.content).toContain('options.bIncludeDK = true;')
  })

  it('selects only Dicktator when only the DK asset is picked', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    sections.GEN.presetAssets = ['DK9 - Dicktator.duf']
    const file = toWorkflowDsa(makeCharacter({ sections }))
    expect(file.content).toContain('options.bIncludeGP = false;')
    expect(file.content).toContain('options.bIncludeDK = true;')
  })

  it('derives bDQS from the selected JCM asset', () => {
    const sections = makeSections()
    sections.JCM.presetAssets = ['G9 LINEAR JCM FAC - Base.duf']
    const file = toWorkflowDsa(makeCharacter({ sections }))
    expect(file.content).toContain('options.bDQS = false;')
    // No selection defaults to DQS (the DTH recommendation).
    expect(toWorkflowDsa(makeCharacter()).content).toContain('options.bDQS = true;')
  })

  it('disables the JCM flag when the section is custom or disabled', () => {
    const sections = makeSections()
    sections.JCM.mode = 'custom'
    const file = toWorkflowDsa(makeCharacter({ sections }))
    expect(file.content).toContain('options.bIncludeJCM = false;')
  })

  it('includes preserveMorphs when set', () => {
    const file = toWorkflowDsa(
      makeCharacter({ preserveMorphs: [{ name: 'body_ctrl_BreastsUp-Down', keepValue: 0.6 }] }),
    )
    expect(file.content).toContain(
      '{ name: "body_ctrl_BreastsUp-Down", keepValue: 0.6 }',
    )
  })

  it('emits strengths and the advanced options when set', () => {
    const file = toWorkflowDsa(
      makeCharacter({
        facsDetailStrength: 0.8,
        preserveNodeTransforms: [{ nodeLabel: 'Left Eye' }],
        jcmMorphMods: [
          {
            boneLabel: 'Left Thigh',
            axis: 'XRotate',
            positive: [],
            negative: [
              {
                morphName: 'SL_Glutes SS Left',
                range: { angle: { start: 0, end: -115 }, value: { start: 0, end: 0.33 } },
              },
            ],
          },
        ],
      }),
    )
    expect(file.content).toContain('options.FACsDetailStrength = 0.8;')
    expect(file.content).toContain('options.FlexionStrength = 1;')
    expect(file.content).toContain('{ nodeLabel: "Left Eye" }')
    expect(file.content).toContain('options.jcmMorphMods = [')
    expect(file.content).toContain('"morphName": "SL_Glutes SS Left"')
  })
})

describe('resolveRomPaths', () => {
  const catalog = {
    folder: 'D:/DAZ 3D/My DAZ 3D Library/DazToHue/Poses',
    assets: [
      { name: 'G9 DQS JCM FAC - Base', relPath: 'Genesis 9/DQS/G9 DQS JCM FAC - Base.duf', genesis: 'G9' as const, skinning: 'dqs' as const, section: 'JCM' as const, includesFac: true },
      { name: 'G9 LINEAR JCM FAC - Base', relPath: 'Genesis 9/Linear/G9 LINEAR JCM FAC - Base.duf', genesis: 'G9' as const, skinning: 'linear' as const, section: 'JCM' as const, includesFac: true },
      { name: 'G9 DQS JCM FAC - Mouth', relPath: 'Genesis 9/DQS/G9 DQS JCM FAC - Mouth.duf', genesis: 'G9' as const, skinning: 'dqs' as const, section: 'FAC' as const, includesFac: false },
      { name: 'GP9 - Golden Palace', relPath: 'Genesis 9/Common/Golden Palace 9/GP9 - Golden Palace.duf', genesis: 'G9' as const, skinning: null, section: 'GEN' as const, includesFac: false },
      { name: 'DK9 - Dicktator', relPath: 'Genesis 9/Common/Dicktator 9/DK9 - Dicktator.duf', genesis: 'G9' as const, skinning: null, section: 'GEN' as const, includesFac: false },
    ],
  }

  it('resolves JCM/mouth/GP paths for a default female character with GEN enabled', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    const paths = resolveRomPaths(makeCharacter({ sections }), catalog)
    expect(paths.jcm).toBe(
      'D:/DAZ 3D/My DAZ 3D Library/DazToHue/Poses/Genesis 9/DQS/G9 DQS JCM FAC - Base.duf',
    )
    expect(paths.mouth).toContain('G9 DQS JCM FAC - Mouth.duf')
    expect(paths.gp).toContain('GP9 - Golden Palace.duf')
    expect(paths.dk).toBeUndefined()
  })

  it('honors an explicit linear JCM selection and follows it for the mouth', () => {
    const sections = makeSections()
    sections.JCM.presetAssets = ['G9 LINEAR JCM FAC - Base.duf']
    const paths = resolveRomPaths(makeCharacter({ sections }), catalog)
    expect(paths.jcm).toContain('G9 LINEAR JCM FAC - Base.duf')
    // No linear mouth in this catalog — falls back to the available one.
    expect(paths.mouth).toContain('Mouth.duf')
  })

  it('returns nothing without a catalog and the wrapper omits the path options', () => {
    expect(resolveRomPaths(makeCharacter(), { folder: '', assets: [] })).toEqual({})
    expect(toWorkflowDsa(makeCharacter()).content).not.toContain('RomPath')
  })

  it('emits the resolved paths in the wrapper', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    const character = makeCharacter({ sections })
    const dsa = toWorkflowDsa(character, resolveRomPaths(character, catalog))
    expect(dsa.content).toContain(
      'options.jcmRomPath = "D:/DAZ 3D/My DAZ 3D Library/DazToHue/Poses/Genesis 9/DQS/G9 DQS JCM FAC - Base.duf";',
    )
    expect(dsa.content).toContain('options.mouthRomPath = ')
    expect(dsa.content).toContain('options.gpRomPath = ')
    expect(dsa.content).not.toContain('options.dkRomPath')
  })
})

describe('generation method groups in the FBM JSON', () => {
  it('emits a groups array for additive/cumulative groups with correct frame ranges', () => {
    const sections = makeSections()
    sections.EXP.enabled = true
    sections.EXP.groups = [
      { ...fbmGroup(), id: 'cum', label: 'AnusOpen', method: 'cumulative' },
    ]
    // FBM group stays individual → not in the groups array.
    const json = JSON.parse(toDazFbmJson(makeCharacter({ sections })).content)
    expect(json.groups).toEqual([
      {
        section: 'EXP',
        name: 'AnusOpen',
        method: 'cumulative',
        startFrame: 1,
        endFrame: 2,
      },
    ])
  })

  it('omits the groups key entirely when all groups are individual/default', () => {
    const json = JSON.parse(toDazFbmJson(makeCharacter()).content)
    expect('groups' in json).toBe(false)
  })
})

describe('toArtDirectionJsons', () => {
  it('generates the per-character GP art direction file and wires it into the wrapper', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    sections.GEN.artDirection = [
      {
        id: 'a1',
        rom: 'gp',
        frame: 100,
        name: 'AnusOpen',
        morphs: [{ node: 'Genesis 9', prop: 'GP_Anus_Open', value: 0.9 }],
      },
      { id: 'a2', rom: 'gp', frame: 96, name: 'VaginaOpen', morphs: [] },
    ]
    const character = makeCharacter({ sections })
    const files = toArtDirectionJsons(character)
    expect(files).toHaveLength(1)
    expect(files[0].fileName).toBe('ElectraG9_GP9ArtDirection.json')
    const json = JSON.parse(files[0].content)
    // Empty frames are skipped — only AnusOpen makes it into the file.
    expect(json.frames).toHaveLength(1)
    expect(json.frames[0]).toEqual({
      frame: 100,
      section: 'GP9',
      name: 'AnusOpen',
      morphs: [{ node: 'Genesis 9', prop: 'GP_Anus_Open', value: 0.9 }],
    })
    const dsa = toWorkflowDsa(character)
    expect(dsa.content).toContain(
      'options.gpArtDirectionPath = dir_self.filePath("ElectraG9_GP9ArtDirection.json");',
    )
    expect(dsa.content).not.toContain('dkArtDirectionPath')
  })

  it('emits nothing without art direction morphs', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    const character = makeCharacter({ sections })
    expect(toArtDirectionJsons(character)).toHaveLength(0)
    expect(toWorkflowDsa(character).content).not.toContain('ArtDirection')
  })
})

describe('toPoseAssetCsv', () => {
  it('uses the ground-truth template for the validated config without GEN', () => {
    const file = toPoseAssetCsv(makeCharacter())
    expect(file.experimental).toBeUndefined()
    expect(file.target).toBe('houdini')
    const lines = file.content.trimEnd().split('\n')
    expect(lines[0]).toBe('RET,0,RestPose')
    expect(lines).toContain('JCMGROUP,0,0,ball_l')
    expect(lines).toContain('JCM,3,BallBD40')
    // GEN disabled → the GP block is stripped and custom frames start at 328.
    expect(lines.some((l) => l.startsWith('GEN'))).toBe(false)
    expect(lines).toContain('FBM,328,BodyTone,')
    expect(lines).toContain('FBM,329,GluteUpDown,')
    expect(lines).toContain('CURVE,CTRL_expressions_browDownL')
    expect(lines).not.toContain('CUSTOM_SECTIONS_PLACEHOLDER')
  })

  it('keeps the GP block and starts custom frames at 432 when GEN is enabled', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    const file = toPoseAssetCsv(makeCharacter({ sections }))
    const lines = file.content.trimEnd().split('\n')
    expect(file.experimental).toBeUndefined()
    expect(lines).toContain('GEN,328,Fence01')
    expect(lines).toContain('GEN,431,ClitorisErect')
    expect(lines).toContain('FBM,432,BodyTone,')
    expect(lines).toContain('FBM,433,GluteUpDown,')
  })

  it('falls back to custom-only rows with index-based group headers off-template', () => {
    const sections = makeSections()
    sections.JCM.mode = 'custom'
    sections.JCM.groups = [
      {
        id: 'gj',
        label: 'ball_l',
        suffix: 'left',
        method: 'individual',
        calculateFrom: 'default',
        poses: [
          { id: 'p1', name: 'BallBD40', morphs: [], referenceFbx: '' },
          { id: 'p2', name: 'BallBU60', morphs: [], referenceFbx: '' },
        ],
      },
    ]
    const file = toPoseAssetCsv(makeCharacter({ sections }))
    expect(file.experimental).toBe(true)
    expect(file.content.trimEnd().split('\n')).toEqual([
      'JCMGROUP,1,0,ball_l',
      'JCM,1,BallBD40',
      'JCM,2,BallBU60',
      'FBM,3,BodyTone,',
      'FBM,4,GluteUpDown,',
    ])
  })
})

// Round-trip against the real DazToHue-Scripts checkout when present on this
// machine: importing ElectraG9_FBMs.json and regenerating must reproduce the
// exact same frame data.
const ELECTRA = 'D:/Development/DazToHue-Scripts/ElectraG9_FBMs.json'

describe.skipIf(!existsSync(ELECTRA))('round-trip with the real ElectraG9_FBMs.json', () => {
  it('reproduces all frames identically', () => {
    const original = JSON.parse(readFileSync(ELECTRA, 'utf8'))
    const sections = sectionsFromFlatFrames(
      [...original.frames].sort((a: any, b: any) => a.frame - b.frame),
    )
    sections.GEN.enabled = true // Electra uses the Golden Palace ROM
    const character = makeCharacter({
      sections,
      resetGPBeforeApplying: original.meta.resetGPBeforeApplying,
    })
    const regenerated = JSON.parse(generateAll(character)[0].content)
    expect(regenerated.frames).toEqual(original.frames)
    expect(regenerated.meta.resetGPBeforeApplying).toBe(original.meta.resetGPBeforeApplying)
  })
})
