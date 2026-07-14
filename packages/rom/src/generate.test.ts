import { describe, expect, it } from 'vitest'

import {
  buildArtDirectionData,
  buildFbmData,
  generateAll,
  poseAssetCsvValidated,
  referenceFrames,
  resolveRomPaths,
  toCharacterScriptDsa,
  toExportScriptDsa,
  toPoseAssetCsv,
  toScanProductsScriptDsa,
} from './generate'
import poseAssetTemplateG9 from './templates/poseasset-g9-dqs-jcmfac-gp-ue5.csv?raw'
import poseAssetTemplateG81 from './templates/poseasset-g8.1-dqs-jcmfac-ue5.csv?raw'

/** Parse the JSON argument of the single `ApplyDTHCharacter(...)` call. The
 *  marker also appears in a comment, so anchor on the last occurrence (the call). */
function characterConfig(content: string) {
  // The config is assigned to a var (so the catch-all error handler can reach
  // it), then passed to ApplyDTHCharacter by name.
  const marker = 'var dthCharacterConfig = '
  const open = content.indexOf(marker) + marker.length
  const close = content.indexOf('\n};', open) + 2
  return JSON.parse(content.slice(open, close))
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
  sections.FBM.enabled = true
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

describe('buildFbmData', () => {
  it('builds the inline extra-frame payload with 0-based frames', () => {
    const data = buildFbmData(makeCharacter())
    expect(data.meta.version).toBe('1.0')
    expect(data.meta.resetGPBeforeApplying).toBe(true)
    expect(data.frames[0]).toEqual({
      frame: 0,
      section: 'FBM',
      name: 'BodyTone',
      morphs: [{ node: 'Genesis9', prop: 'body_bs_BodyTone', value: 1 }],
    })
    expect(data.frames[1].frame).toBe(1)
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
    const data = buildFbmData(makeCharacter({ sections }))
    expect(data.frames[0].morphs[0]).toEqual({
      node: 'GoldenPalace_G9',
      prop: 'GP9_Anus_Depth',
      value: 0.5,
      base: 0.2,
    })
    // toEqual is exact: asserts autoBase is present AND base is absent.
    expect(data.frames[1].morphs[0]).toEqual({
      node: 'Genesis9',
      prop: 'SS_body_bs_Glute UpDown',
      value: -1,
      autoBase: true,
    })
  })
})

describe('PoseAsset templates', () => {
  const templates = [
    ['G9 CURVE-tail', poseAssetTemplateG9],
    ['G8.1 CTL-tail', poseAssetTemplateG81],
  ] as const

  for (const [label, csv] of templates) {
    it(`the ${label} template carries the custom-sections sentinel exactly once`, () => {
      // spliceTemplate throws if it's missing — so a template that loses it can't
      // silently ship a corrupt CSV.
      const count = csv.split(/\r?\n/).filter((l) => l.trim() === 'CUSTOM_SECTIONS_PLACEHOLDER').length
      expect(count).toBe(1)
    })
  }
})

describe('toCharacterScriptDsa', () => {
  it('emits one self-contained script that calls ApplyDTHCharacter with inline data', () => {
    const file = toCharacterScriptDsa(makeCharacter())
    expect(file.fileName).toBe('ROM_ElectraG9_G9.dsa')
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

  it('adds the tear-UV step + flag for a G9 character that opted in', () => {
    const file = toCharacterScriptDsa(makeCharacter({ genesis: 'G9', applyUE5TearUV: true }))
    expect(characterConfig(file.content).bApplyUE5TearUV).toBe(true)
    expect(file.content).toContain('function dthApplyUE5TearUV()')
    expect(file.content).toContain('if (dthCharacterConfig.bApplyUE5TearUV) { dthApplyUE5TearUV(); }')
    expect(file.content).toContain('setValueFromString("UE5")')
  })

  it('keeps the tear-UV flag false when not opted in, and forces it off on non-G9', () => {
    expect(
      characterConfig(toCharacterScriptDsa(makeCharacter({ genesis: 'G9', applyUE5TearUV: false })).content)
        .bApplyUE5TearUV,
    ).toBe(false)
    expect(
      characterConfig(toCharacterScriptDsa(makeCharacter({ genesis: 'G8', applyUE5TearUV: true })).content)
        .bApplyUE5TearUV,
    ).toBe(false)
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

  it('forward-slashes a custom JCM asset path (DzFile wants /)', () => {
    const sections = makeSections()
    sections.JCM.mode = 'custom'
    sections.JCM.customAssetPath = 'D:\\DAZ 3D\\My Lib\\Custom Base.duf'
    const config = characterConfig(toCharacterScriptDsa(makeCharacter({ sections })).content)
    expect(config.jcmRomPath).toBe('D:/DAZ 3D/My Lib/Custom Base.duf')
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

  it('bakes the run-log path + metadata, and a catch-all that still reports', () => {
    const withFolder = toCharacterScriptDsa(makeCharacter(), {}, undefined, 'D:\\lib\\Electra')
    const config = characterConfig(withFolder.content)
    expect(config.runLogPath).toBe('D:/lib/Electra/dth_rom_run_log.json')
    expect(config.characterName).toBe('Electra G9')
    expect(typeof config.runtimeVersion).toBe('number')
    // Even a catastrophic failure (runtime missing, unexpected exception) writes
    // a minimal log and tells the user to check the studio.
    expect(withFolder.content).toContain('catch (dthErr)')
    expect(withFolder.content).toContain('MessageBox.critical')
    expect(withFolder.content).toContain('dthCharacterConfig.runLogPath')
    // REGRESSION GUARD (v13 broke every script): include() must stay at the TOP
    // level — Daz resolves it via its legacy-include mechanism, which fails
    // inside try/catch ("URIError: Legacy Include"). Top level = unindented line;
    // wrapping it in any block would indent it.
    expect(withFolder.content).toMatch(/^include\(dir_self\.filePath/m)
    // A missing runtime is guarded by a typeof check, not by wrapping include().
    expect(withFolder.content).toContain('typeof ApplyDTHCharacter != "function"')
    // Pure/web context (no character folder): no log path, catch-all still there.
    const noFolder = characterConfig(toCharacterScriptDsa(makeCharacter()).content)
    expect(noFolder.runLogPath).toBeUndefined()
  })

  it('non-G9: genesis in the config, G9-only strength dials zeroed', () => {
    const g81 = characterConfig(
      toCharacterScriptDsa(makeCharacter({ genesis: 'G8.1' })).content,
    )
    expect(g81.genesis).toBe('G8.1')
    // Dialing facs_ctrl_/body_ctrl_ strengths on a non-G9 figure would log a
    // spurious "property not found" run failure — 0 makes the runtime skip them.
    expect(g81.FACsDetailStrength).toBe(0)
    expect(g81.FlexionStrength).toBe(0)
    const g9 = characterConfig(toCharacterScriptDsa(makeCharacter()).content)
    expect(g9.FACsDetailStrength).toBe(1)
    expect(g9.FlexionStrength).toBe(1)
  })
})

describe('toScanProductsScriptDsa', () => {
  const opts = {
    dimManifestPath: 'E:\\DAZ 3D\\Install Manager\\ManifestFiles',
    outputDir: 'C:\\Users\\me\\AppData\\Local\\app\\product-scans\\proj\\char',
    dazLibraryFolder: 'D:\\DAZ 3D\\My DAZ 3D Library',
  }

  it('emits a Scan_Products_<slug>.dsa that includes the DthProducts runtime and calls DthScanProducts', () => {
    const file = toScanProductsScriptDsa(makeCharacter(), opts)
    expect(file.fileName).toBe('Scan_Products_ElectraG9.dsa')
    expect(file.target).toBe('daz')
    expect(file.content).toContain('// DTH-Runtime: v')
    expect(file.content).toContain('include(dir_self.filePath("../../.DthProducts.dsa"));')
    expect(file.content).toContain('DthScanProducts(')
  })

  it('embeds the character identity and forward-slashed paths', () => {
    const open = file2config(toScanProductsScriptDsa(makeCharacter(), opts).content)
    expect(open.characterId).toBe('test')
    expect(open.characterName).toBe('Electra G9')
    expect(open.genesis).toBe('G9')
    // Backslashes are forward-slashed before embedding (DzFile/DzDir want '/').
    expect(open.dimManifestPath).toBe('E:/DAZ 3D/Install Manager/ManifestFiles')
    expect(open.outputDir).toBe('C:/Users/me/AppData/Local/app/product-scans/proj/char')
    expect(open.dazLibraryFolder).toBe('D:/DAZ 3D/My DAZ 3D Library')
  })
})

/** Parse the JSON argument of the single `DthScanProducts(...)` call. */
function file2config(content: string) {
  const open = content.lastIndexOf('DthScanProducts(') + 'DthScanProducts('.length
  return JSON.parse(content.slice(open, content.lastIndexOf(');')))
}

describe('generateAll', () => {
  it('produces the character script (daz) and the PoseAsset CSV (houdini)', () => {
    const files = generateAll(makeCharacter(), {}, FRAMES)
    expect(files.map((f) => [f.fileName, f.target])).toEqual([
      ['ROM_ElectraG9_G9.dsa', 'daz'],
      ['ElectraG9_pose_asset.csv', 'houdini'],
    ])
  })

  it('omits the scan script unless scanProducts options are passed', () => {
    const files = generateAll(makeCharacter(), {}, FRAMES, undefined, undefined, {
      dimManifestPath: 'E:/DIM/ManifestFiles',
      outputDir: 'C:/data/product-scans/proj/char',
      dazLibraryFolder: 'D:/DAZ 3D/My DAZ 3D Library',
    })
    expect(files.map((f) => f.fileName)).toEqual([
      'ROM_ElectraG9_G9.dsa',
      'Scan_Products_ElectraG9.dsa',
      'ElectraG9_pose_asset.csv',
    ])
    // Without the options the scan script is not emitted.
    expect(generateAll(makeCharacter(), {}, FRAMES).map((f) => f.fileName)).not.toContain(
      'Scan_Products_ElectraG9.dsa',
    )
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

  it('returns nothing without a catalog and the script config omits the path options', () => {
    expect(resolveRomPaths(makeCharacter(), { folder: '', assets: [] })).toEqual({})
    const config = characterConfig(toCharacterScriptDsa(makeCharacter()).content)
    expect(config.jcmRomPath).toBeUndefined()
    expect(config.mouthRomPath).toBeUndefined()
  })

  it('emits the resolved paths into the character-script config', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    const character = makeCharacter({ sections })
    const config = characterConfig(
      toCharacterScriptDsa(character, resolveRomPaths(character, catalog)).content,
    )
    expect(config.jcmRomPath).toBe(
      'D:/DAZ 3D/My DAZ 3D Library/DazToHue/Poses/Genesis 9/DQS/G9 DQS JCM FAC - Base.duf',
    )
    expect(config.mouthRomPath).toBeDefined()
    expect(config.gpRomPath).toBeDefined()
    expect(config.dkRomPath).toBeUndefined()
  })
})

describe('generation method groups in the FBM data', () => {
  it('emits a groups array for additive/cumulative groups with correct frame ranges', () => {
    const sections = makeSections()
    sections.EXP.enabled = true
    sections.EXP.groups = [
      { ...fbmGroup(), id: 'cum', label: 'AnusOpen', method: 'cumulative' },
    ]
    // FBM group stays individual → not in the groups array.
    const data = buildFbmData(makeCharacter({ sections }))
    expect('groups' in data).toBe(true)
    expect((data as { groups?: unknown }).groups).toEqual([
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
    expect('groups' in buildFbmData(makeCharacter())).toBe(false)
  })
})

describe('buildArtDirectionData', () => {
  it('keeps only the frames that have morphs, sorted by frame, and inlines them into the script', () => {
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
    const json = buildArtDirectionData(character, 'gp', 'GP9', 'Golden Palace')
    // Empty frames are skipped — only AnusOpen survives.
    expect(json?.frames).toHaveLength(1)
    expect(json?.frames[0]).toEqual({
      frame: 100,
      section: 'GP9',
      name: 'AnusOpen',
      morphs: [{ node: 'Genesis 9', prop: 'GP_Anus_Open', value: 0.9 }],
    })
    // The character script inlines the same data as config.gpArtDirection (no DK).
    const config = characterConfig(toCharacterScriptDsa(character).content)
    expect(config.gpArtDirection.frames[0].name).toBe('AnusOpen')
    expect(config.dkArtDirection).toBeUndefined()
  })

  it('returns null without art direction morphs, and the script inlines nothing', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    const character = makeCharacter({ sections })
    expect(buildArtDirectionData(character, 'gp', 'GP9', 'Golden Palace')).toBeNull()
    const config = characterConfig(toCharacterScriptDsa(character).content)
    expect(config.gpArtDirection).toBeUndefined()
    expect(config.dkArtDirection).toBeUndefined()
  })
})

describe('toPoseAssetCsv', () => {
  it('uses the ground-truth template for the validated config without GEN', () => {
    const file = toPoseAssetCsv(makeCharacter(), FRAMES, '2.0')
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
    const file = toPoseAssetCsv(makeCharacter({ sections }), FRAMES, '2.0')
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
    const file = toPoseAssetCsv(makeCharacter({ sections }), FRAMES, '2.0')
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
    // No preset base ROM (JCM custom-groups, empty base path) → the FIRST custom
    // pose lands at frame 0, matching the Daz runtime's startFrame=0. (This used
    // to wrongly start at 1 — the Math.max(...,0) off-by-one, now fixed.)
    expect(file.content.trimEnd().split('\n')).toEqual([
      'JCMGROUP,1,0,ball_l',
      'JCM,0,BallBD40',
      'JCM,1,BallBU60',
      'FBM,2,BodyTone,',
      'FBM,3,GluteUpDown,',
    ])
  })

  it('a base-less character (only FBMs) starts custom frames at 0, not 1', () => {
    // The core-invariant regression guard: FBM-only, no JCM/FAC/GEN/PHY preset.
    const sections = makeSections()
    sections.JCM.enabled = false
    const file = toPoseAssetCsv(makeCharacter({ sections }), FRAMES)
    const first = file.content.trimEnd().split('\n').find((l) => l.startsWith('FBM,'))
    expect(first).toBe('FBM,0,BodyTone,')
    // referenceFrames uses the same offset — a base-less reference pose is at 0 too.
    const refChar = makeCharacter({
      sections: {
        ...sections,
        FBM: {
          ...sections.FBM,
          groups: [
            {
              id: 'g',
              label: '',
              suffix: 'centre',
              method: 'individual',
              calculateFrom: 'default',
              poses: [{ id: 'r', name: 'Ref', morphs: [], referenceFbx: 'ref.fbx' }],
            },
          ],
        },
      },
    })
    expect(referenceFrames(refChar, FRAMES)).toEqual([0])
  })

  it('sanitizes control chars out of .dsa comment headers (Daz Script injection)', () => {
    const evil = 'Kira\n DzFile("x").remove(); //'
    const content = toCharacterScriptDsa(makeCharacter({ name: evil }), {}, FRAMES).content
    // The name reaches the // header, but the newline must be stripped so it can't
    // break out of the comment into executable DzScript.
    const header = content.split('\n').find((l) => l.includes('DTH ROM for')) ?? ''
    expect(header).toContain('Kira  DzFile') // newline collapsed to a space
    expect(header).not.toMatch(/\n/)
    // No standalone line in the whole script starts with the injected call.
    expect(content.split('\n').some((l) => l.trim().startsWith('DzFile('))).toBe(false)
  })

  it('sanitizes commas/newlines out of CSV group labels + reference FBX', () => {
    const sections = makeSections()
    sections.JCM.mode = 'custom'
    sections.JCM.groups = [
      {
        id: 'g',
        label: 'evil,label\ninjected',
        suffix: 'left',
        method: 'individual',
        calculateFrom: 'default',
        poses: [{ id: 'p', name: 'Pose', morphs: [], referenceFbx: 'a,b\nc.fbx' }],
      },
    ]
    const rows = toPoseAssetCsv(makeCharacter({ sections }), FRAMES).content.split('\n')
    const group = rows.find((r) => r.startsWith('JCMGROUP')) ?? ''
    expect(group).toBe('JCMGROUP,1,0,evil label injected') // comma + newline → space
    expect(rows.every((r) => !r.includes('\n'))).toBe(true)
  })
})

// Finding 2: the G9 gate pins the baked block lengths (base 328, GP 104) the same
// way the G8.1 gate pins 188 — a base/GP that measures differently (a future or
// custom asset) can't silently splice custom rows at the wrong offset; it falls to
// the experimental custom-only path instead.
describe('toPoseAssetCsv — G9 baked-length guard', () => {
  it('stays experimental on an unexpected base length', () => {
    expect(toPoseAssetCsv(makeCharacter(), { ...FRAMES, base: 330 }, '2.0').experimental).toBe(true)
  })

  it('stays experimental when GP is included but the GP block measures ≠ 104', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    const file = toPoseAssetCsv(makeCharacter({ sections }), { ...FRAMES, gp: 96 }, '2.0')
    expect(file.experimental).toBe(true)
  })

  it('ignores GP length when GP is not included (the baked GP rows are stripped)', () => {
    // GEN off → the wrong gp measurement is irrelevant, still validated.
    expect(toPoseAssetCsv(makeCharacter(), { ...FRAMES, gp: 96 }, '2.0').experimental).toBeUndefined()
  })

  it('is experimental until the base length is measured (undefined = not validated)', () => {
    // poseAssetCsvValidated with no measured base — symmetric with G8.1.
    expect(poseAssetCsvValidated(makeCharacter(), '2.0')).toBe(false)
    expect(poseAssetCsvValidated(makeCharacter(), '2.0', 328)).toBe(true)
  })
})

// The product invariant, guarded across a config matrix: the Houdini PoseAsset CSV
// and the Daz-side script derive every custom frame's position from the SAME
// measured preset-block lengths, so the two artifacts can't drift. (Only three
// configs were hand-checked before; this proves the property, not just examples.)
describe('frame alignment: PoseAsset CSV ↔ Daz config (no drift)', () => {
  const cases: Array<{ label: string; patch: (s: RomSections) => void }> = [
    { label: 'base only', patch: () => {} },
    { label: 'GEN (GP)', patch: (s) => { s.GEN.enabled = true } },
    {
      label: 'GEN + PHY',
      patch: (s) => { s.GEN.enabled = true; s.PHY.enabled = true; s.PHY.mode = 'preset' },
    },
    { label: 'base-less (FBM only)', patch: (s) => { s.JCM.enabled = false } },
  ]
  for (const { label, patch } of cases) {
    it(`custom frames start at the measured preset offset — ${label}`, () => {
      const sections = makeSections()
      patch(sections)
      const character = makeCharacter({ sections })
      const offset = presetFrameCount(sections, character.gender, FRAMES)

      // Houdini side: the first custom (FBM) row lands at exactly that offset.
      const firstFbm = toPoseAssetCsv(character, FRAMES)
        .content.trimEnd()
        .split('\n')
        .find((l) => l.startsWith('FBM,'))
      expect(firstFbm).toBe(`FBM,${offset},BodyTone,`)

      // Daz side: the script carries the SAME measured preset lengths, and its
      // inline custom frames are 0-based — so the runtime places that block at the
      // identical absolute frame (offset + 0). Same inputs → no drift, by construction.
      const cfg = characterConfig(toCharacterScriptDsa(character, {}, FRAMES).content)
      expect(cfg.presetFrames).toEqual(FRAMES)
      expect(cfg.extraFrames.frames[0].frame).toBe(0)
    })
  }
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

  it('combined (default): one script that builds the ROM and exports', () => {
    const character = withReferencePose({ name: 'Electra', exportPath: 'X:\\exports\\electra' })
    const rom = toCharacterScriptDsa(character, {}, FRAMES, 'D:\\lib\\Electra')
    expect(rom.fileName).toBe('ROM_Electra_G9.dsa')
    expect(rom.content).toContain('ApplyDTHCharacter(')
    expect(rom.content).toContain('doExport')
    const files = generateAll(character, {}, FRAMES, 'D:\\lib\\Electra')
    expect(files.map((f) => f.fileName)).toEqual(['ROM_Electra_G9.dsa', 'Electra_pose_asset.csv'])
  })

  it('split (exportWithRomScript off): ROM_ script builds, Export_ script exports', () => {
    const character = withReferencePose({
      name: 'Electra',
      exportPath: 'X:\\exports\\electra',
      exportWithRomScript: false,
    })
    const rom = toCharacterScriptDsa(character, {}, FRAMES, 'D:\\lib\\Electra')
    expect(rom.fileName).toBe('ROM_Electra_G9.dsa')
    expect(rom.content).toContain('ApplyDTHCharacter(')
    expect(rom.content).not.toContain('doExport') // ROM only, no export

    const exportScript = toExportScriptDsa(character, FRAMES, 'D:\\lib\\Electra')
    expect(exportScript.fileName).toBe('Export_Electra_G9.dsa')
    expect(exportScript.content).not.toContain('ApplyDTHCharacter(') // no ROM rebuild
    expect(exportScript.content).toContain('doExport')
    expect(exportScript.content).toContain('dthCsvSrc.copy(dthCsvDst)')

    expect(generateAll(character, {}, FRAMES, 'D:\\lib\\Electra').map((f) => f.fileName)).toEqual([
      'ROM_Electra_G9.dsa',
      'Export_Electra_G9.dsa',
      'Electra_pose_asset.csv',
    ])
  })

  it('split has no effect without an export path (stays one combined script)', () => {
    const character = withReferencePose({ name: 'Electra', exportWithRomScript: false })
    const rom = toCharacterScriptDsa(character, {}, FRAMES, 'D:\\lib\\Electra')
    expect(rom.fileName).toBe('ROM_Electra_G9.dsa')
    expect(generateAll(character, {}, FRAMES).map((f) => f.fileName)).toEqual([
      'ROM_Electra_G9.dsa',
      'Electra_pose_asset.csv',
    ])
  })
})

describe('toPoseAssetCsv — G8.1 template (pre-2.0 / CTL era)', () => {
  const G81_FRAMES = { base: 188, gp: 0, dk: 0, phys: 0 }

  it('splices the ground-truth template; custom frames continue at 188', () => {
    const file = toPoseAssetCsv(makeCharacter({ genesis: 'G8.1' }), G81_FRAMES, '')
    expect(file.experimental).toBeUndefined()
    const lines = file.content.trimEnd().split('\n')
    expect(lines[0]).toBe('RET,0,RestPose')
    expect(lines).toContain('JCM,99,HeadBB30')
    expect(lines).toContain('FAC,187,TongueTwistLeft')
    expect(lines).toContain('FBM,188,BodyTone,')
    // Pre-2.0 nodes read CTL control rows — CURVE would import broken there.
    expect(lines).toContain('CTL,facWrinkle44_mat')
    expect(file.content).not.toContain('CURVEGROUP')
  })

  it('emits the template under ANY active era (G8.1 targets the pre-2.0 HDA)', () => {
    const character = makeCharacter({ genesis: 'G8.1' })
    const file = toPoseAssetCsv(character, G81_FRAMES, '2.0')
    expect(file.experimental).toBeUndefined()
    expect(file.content).toContain('CTL,facWrinkle44_mat')
  })

  it('stays experimental on an unexpected base length', () => {
    const character = makeCharacter({ genesis: 'G8.1' })
    expect(toPoseAssetCsv(character, { ...G81_FRAMES, base: 190 }, '').experimental).toBe(true)
  })

  it('G9 on the pre-2.0 era is experimental too (its template carries CURVE rows)', () => {
    expect(toPoseAssetCsv(makeCharacter(), FRAMES, '').experimental).toBe(true)
  })
})
