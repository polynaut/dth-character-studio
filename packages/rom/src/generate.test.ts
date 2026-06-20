import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  generateAll,
  referenceFrames,
  resolveRomPaths,
  toArtDirectionJsons,
  toCharacterScriptDsa,
  toDazFbmCsv,
  toDazFbmJson,
  toPoseAssetCsv,
  toWorkflowDsa,
} from './generate'

/** Parse the JSON argument of the single `ApplyDTHCharacter(...)` call. The
 *  marker also appears in a comment, so anchor on the last occurrence (the call). */
function characterConfig(content: string) {
  const open = content.lastIndexOf('ApplyDTHCharacter(') + 'ApplyDTHCharacter('.length
  return JSON.parse(content.slice(open, content.lastIndexOf(');')))
}
import {
  characterSchema,
  defaultSections,
  flattenRom,
  mirrorGroup,
  presetFrameCount,
  sectionsFromFlatFrames,
} from './types'

import type { Character, PresetFrames, RomGroup, RomSections } from './types'

/** Known preset-block lengths (the validated DTH G9 assets) — the pure frame
 *  math now takes measured frames explicitly instead of hard-coded constants. */
const FRAMES: PresetFrames = { base: 328, gp: 104, dk: 54, phys: 43 }

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
  it('numbers frames 0-based across enabled custom sections in canonical order', () => {
    const sections = makeSections()
    sections.EXP.enabled = true
    sections.EXP.groups = [{ ...fbmGroup(), id: 'exp1' }]
    const frames = flattenRom(sections)
    expect(frames.map((f) => [f.frame, f.section, f.name])).toEqual([
      [0, 'EXP', 'BodyTone'],
      [1, 'EXP', 'Glute UpDown'],
      [2, 'FBM', 'BodyTone'],
      [3, 'FBM', 'Glute UpDown'],
    ])
  })

  it('skips disabled and preset sections', () => {
    const sections = makeSections()
    sections.FBM.enabled = false
    expect(flattenRom(sections)).toEqual([])
  })
})

describe('presetFrameCount', () => {
  it('is the absolute frame of the first custom pose (matches the generated CSV)', () => {
    // base only (GEN off) → custom starts at 328
    expect(presetFrameCount(makeSections(), 'female', FRAMES)).toBe(328)

    const gp = makeSections()
    gp.GEN.enabled = true
    expect(presetFrameCount(gp, 'female', FRAMES)).toBe(432)

    const gpPhy = makeSections()
    gpPhy.GEN.enabled = true
    gpPhy.PHY.enabled = true
    gpPhy.PHY.mode = 'preset'
    expect(presetFrameCount(gpPhy, 'female', FRAMES)).toBe(475)
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
  it('produces the DazToHue-Scripts FBM JSON format with 0-based frames', () => {
    const file = toDazFbmJson(makeCharacter())
    expect(file.fileName).toBe('ElectraG9_FBMs.json')
    const json = JSON.parse(file.content)
    expect(json.meta.version).toBe('1.0')
    expect(json.meta.resetGPBeforeApplying).toBe(true)
    expect(json.frames[0]).toEqual({
      frame: 0,
      section: 'FBM',
      name: 'BodyTone',
      morphs: [{ node: 'Genesis9', prop: 'body_bs_BodyTone', value: 1 }],
    })
    expect(json.frames[1].frame).toBe(1)
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
  it('matches the flat CSV format, 0-based (first morph at frame 0)', () => {
    const file = toDazFbmCsv(makeCharacter())
    const lines = file.content.trimEnd().split('\n')
    expect(lines[0]).toBe('0,FBM,BodyTone,Genesis9,body_bs_BodyTone,1')
    expect(lines[1]).toBe('1,FBM,Glute UpDown,Genesis9,SS_body_bs_Glute UpDown,-1')
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

describe('toCharacterScriptDsa', () => {
  it('emits one self-contained script that calls ApplyDTHCharacter with inline data', () => {
    const file = toCharacterScriptDsa(makeCharacter())
    expect(file.fileName).toBe('ElectraG9_G9.dsa')
    expect(file.target).toBe('daz')
    expect(file.content).toContain('include(dir_self.filePath("../../.DthWorkflow.dsa"));')
    expect(file.content).toContain('ApplyDTHCharacter(')
    const config = characterConfig(file.content)
    expect(config.bIncludeJCM).toBe(true)
    expect(config.bDQS).toBe(true)
    expect(config.extraFrames.frames[0]).toEqual({
      frame: 0,
      section: 'FBM',
      name: 'BodyTone',
      morphs: [{ node: 'Genesis9', prop: 'body_bs_BodyTone', value: 1 }],
    })
    // No separate FBM / CSV / art-direction files — everything is inline.
    expect(file.content).not.toContain('extraJSONs')
    expect(file.content).not.toContain('_FBMs.json')
  })

  it('inlines GP art direction when GEN/GP is enabled', () => {
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
    ]
    const config = characterConfig(toCharacterScriptDsa(makeCharacter({ sections })).content)
    expect(config.bIncludeGP).toBe(true)
    expect(config.gpArtDirection.frames[0].morphs[0].prop).toBe('GP_Anus_Open')
    expect(config.dkArtDirection).toBeUndefined()
  })

  it('passes the resolved ROM paths through to the config', () => {
    const config = characterConfig(
      toCharacterScriptDsa(makeCharacter(), {
        jcm: 'P/G9 DQS JCM FAC - Base.duf',
        gp: 'P/GP9 - Golden Palace.duf',
      }).content,
    )
    expect(config.jcmRomPath).toBe('P/G9 DQS JCM FAC - Base.duf')
    expect(config.gpRomPath).toBe('P/GP9 - Golden Palace.duf')
  })
})

describe('generateAll', () => {
  it('produces the character script (daz) and the PoseAsset CSV (houdini)', () => {
    const files = generateAll(makeCharacter(), {}, FRAMES)
    expect(files.map((f) => [f.fileName, f.target])).toEqual([
      ['ElectraG9_G9.dsa', 'daz'],
      ['ElectraG9_pose_asset.csv', 'houdini'],
    ])
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
        startFrame: 0,
        endFrame: 1,
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
    const file = toPoseAssetCsv(makeCharacter(), FRAMES)
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
    const file = toPoseAssetCsv(makeCharacter({ sections }), FRAMES)
    const lines = file.content.trimEnd().split('\n')
    expect(file.experimental).toBeUndefined()
    expect(lines).toContain('GEN,328,Fence01')
    expect(lines).toContain('GEN,431,ClitorisErect')
    expect(lines).toContain('FBM,432,BodyTone,')
    expect(lines).toContain('FBM,433,GluteUpDown,')
  })

  it('inserts the fixed PHY block after GP and shifts custom frames when physics is enabled', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    sections.PHY.enabled = true
    sections.PHY.mode = 'preset'
    const file = toPoseAssetCsv(makeCharacter({ sections }), FRAMES)
    const lines = file.content.trimEnd().split('\n')
    expect(file.experimental).toBeUndefined()
    // base 0-327, GP 328-431, PHY 432-474, custom (FBM) 475+.
    expect(lines).toContain('GEN,431,ClitorisErect')
    expect(lines).toContain('PHYGROUP,0,0,breast_l,5.0,5.0')
    expect(lines).toContain('PHY,432,BreastOut,-5.0,0.0,0.0')
    expect(lines).toContain('PHY,452,GluteUp,0.0,5.0,0.0')
    expect(lines).toContain('PHY,460,GluteUp,0.0,5.0,0.0')
    expect(lines).toContain('PHY,474,StomachHangForward,0.0,0.0,-5.0')
    expect(lines).toContain('FBM,475,BodyTone,')
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
    const file = toPoseAssetCsv(makeCharacter({ sections }), FRAMES)
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
      resetGenBeforeApplying: original.meta.resetGPBeforeApplying,
    })
    const regenerated = JSON.parse(toDazFbmJson(character).content)
    expect(regenerated.frames).toEqual(original.frames)
    expect(regenerated.meta.resetGPBeforeApplying).toBe(original.meta.resetGPBeforeApplying)
  })
})

describe('exporter integration', () => {
  /** A character with one reference-skeleton FBM pose and no GEN preset (so the
   *  CSV carries no template GEN rows to confuse the reference-frame check). */
  function withReferencePose(overrides: Partial<Character> = {}): Character {
    const sections = makeSections()
    sections.GEN.enabled = false
    sections.FBM.groups[0].poses[0].referenceFbx = 'ProportionHeight.fbx'
    return makeCharacter({ sections, ...overrides })
  }

  it('referenceFrames matches the CSV frames of the reference-skeleton poses', () => {
    const character = withReferencePose()
    const csvRefFrames = toPoseAssetCsv(character, FRAMES)
      .content.split('\n')
      .map((line) => line.split(','))
      .filter((c) => ['FBM', 'MIS', 'GEN'].includes(c[0]) && (c[3] ?? '').trim() !== '')
      .map((c) => Number(c[1]))
      .sort((a, b) => a - b)
    expect(csvRefFrames.length).toBe(1)
    expect(referenceFrames(character, FRAMES)).toEqual(csvRefFrames)
  })

  it('appends a doExport call (forward-slashed path, reference frames) when an export path is set', () => {
    const character = withReferencePose({ name: 'Electra', exportPath: 'X:\\exports\\electra' })
    const content = toCharacterScriptDsa(character, {}, FRAMES).content
    const refs = referenceFrames(character, FRAMES).join(' ')
    expect(content).toContain('findAction("DazToHueExporterAction")')
    expect(content).toContain('var dthExportDir = "X:/exports/electra";')
    expect(content).toContain(`dthExportAction.doExport(dthExportDir, "Electra", "${refs}", false)`)
  })

  it('omits the export call when no export path is set', () => {
    expect(toCharacterScriptDsa(makeCharacter(), {}, FRAMES).content).not.toContain('doExport')
  })

  it('nests the export under the open scene name when exportSceneSubfolders is set', () => {
    const character = withReferencePose({
      name: 'Electra',
      exportPath: 'X:\\exports\\electra',
      exportSceneSubfolders: true,
    })
    const content = toCharacterScriptDsa(character, {}, FRAMES).content
    expect(content).toContain('Scene.getFilename()')
    expect(content).toContain('new DzFileInfo(dthSceneFile).completeBaseName()')
    expect(content).toContain('dthExportDir = dthExportDir + "/" + dthSceneName')
  })

  it('does not read the scene name when exportSceneSubfolders is off', () => {
    const character = withReferencePose({ name: 'Electra', exportPath: 'X:\\exports\\electra' })
    expect(toCharacterScriptDsa(character, {}, FRAMES).content).not.toContain('Scene.getFilename()')
  })

  it('copies the PoseAsset CSV from the character folder into the resolved export dir', () => {
    const character = withReferencePose({ name: 'Electra', exportPath: 'X:\\exports\\electra' })
    const content = toCharacterScriptDsa(character, {}, FRAMES, 'D:\\lib\\Electra').content
    expect(content).toContain('var dthCsvName = "Electra_pose_asset.csv";')
    expect(content).toContain('var dthCsvSrcDir = new DzDir("D:/lib/Electra");')
    // A copy (not a move) so the source survives for the next scene's export.
    expect(content).toContain('dthCsvSrc.copy(dthCsvDst)')
    expect(content).not.toContain('.move(')
    // Destination is the resolved export dir (dthExportDir), so the scene
    // subfolder is included when that option is on.
    expect(content).toContain('dthCsvDstDir.absoluteFilePath(dthCsvName)')
  })

  it('omits the CSV copy when the character folder is unknown', () => {
    const character = withReferencePose({ name: 'Electra', exportPath: 'X:\\exports\\electra' })
    // No charFolderAbs (pure/web context): export runs, but no copy block.
    expect(toCharacterScriptDsa(character, {}, FRAMES).content).not.toContain('dthCsvSrcDir')
  })
})
