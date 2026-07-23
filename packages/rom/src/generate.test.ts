import { describe, expect, it } from 'vitest'

import {
  buildArtDirectionData,
  buildFbmData,
  facPresetSupport,
  generateAll,
  GENERATION_TEMPLATE_CSV,
  poseAssetCsvValidated,
  presetFramesSignature,
  referenceFrames,
  resolveRomPaths,
  sectionPresetAvailable,
  templateBakedPoseNames,
  toCharacterScriptDsa,
  toExportScriptDsa,
  toGroomExportScriptDsa,
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
  boneScaleRefPoses,
  flattenRom,
  genRomStartFrame,
  mirrorGroup,
  presetEndFrame,
  presetFrameCount,
  sectionsFromFlatFrames,
} from './frames'
import { characterSchema, defaultSections, flatSectionGroupId, GENERATIONS } from './types'
import { romValidationErrors } from './validation'
import type { GenesisVersion } from './types'

import type { PresetFrames } from './frames'
import type { Character, RomGroup, RomSections } from './types'

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
        morphs: [{ id: 'm1', node: 'Genesis9', prop: 'body_bs_BodyTone', value: 1 }],
        boneScaleRef: false,
      },
      {
        id: 'p2',
        name: 'Glute UpDown',
        morphs: [{ id: 'm2', node: 'Genesis9', prop: 'SS_body_bs_Glute UpDown', value: -1 }],
        boneScaleRef: false,
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

  it('coalesces ALTERNATING flat-section runs into ONE stable group per flat section', () => {
    // Flat sections (FBM/MISC) have exactly one group by definition — an
    // interleaved legacy file (FBM, MISC, FBM) used to mint a SECOND FBM group,
    // a shape the editor never produces. The single group must carry the stable
    // flatSectionGroupId so scene-override additions can target imported flat
    // sections exactly like the editor's implicit group.
    const sections = sectionsFromFlatFrames([
      { section: 'FBM', name: 'Heavy', morphs: [] },
      { section: 'MISC', name: 'Odd', morphs: [] },
      { section: 'FBM', name: 'Tall', morphs: [] },
    ])
    expect(sections.FBM.groups).toHaveLength(1)
    expect(sections.FBM.groups[0].id).toBe(flatSectionGroupId('FBM'))
    expect(sections.FBM.groups[0].poses.map((p) => p.name)).toEqual(['Heavy', 'Tall'])
    expect(sections.MISC.groups).toHaveLength(1)
    expect(sections.MISC.groups[0].id).toBe(flatSectionGroupId('MISC'))
  })

  it('grouped sections still split alternating runs into separate groups', () => {
    // EXP/JCM/… keep run semantics: a run boundary IS a group boundary there.
    const sections = sectionsFromFlatFrames([
      { section: 'EXP', name: 'Angry', morphs: [] },
      { section: 'JCM', name: 'Bend', morphs: [] },
      { section: 'EXP', name: 'Happy', morphs: [] },
    ])
    expect(sections.EXP.groups).toHaveLength(2)
    expect(sections.EXP.groups[0].poses.map((p) => p.name)).toEqual(['Angry'])
    expect(sections.EXP.groups[1].poses.map((p) => p.name)).toEqual(['Happy'])
    expect(sections.EXP.groups[0].id).not.toBe(sections.EXP.groups[1].id)
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
          morphs: [{ id: 'ml', node: 'Golden Palace', prop: 'GPL_Majora_Push 1_Left', value: 1 }],
          boneScaleRef: false,
        },
      ],
    }
    const right = mirrorGroup(left)
    expect(right.suffix).toBe('right')
    expect(right.id).not.toBe(left.id)
    expect(right.poses[0].name).toBe('MajoraPush1')
    expect(right.poses[0].morphs[0].prop).toBe('GPL_Majora_Push 1_Right')
  })

  it('leaves non-sided names containing "left" mid-word untouched (CleftChin)', () => {
    const left: RomGroup = {
      id: 'gl',
      label: '',
      suffix: 'left',
      method: 'individual',
      calculateFrom: 'default',
      poses: [
        {
          id: 'pl',
          name: 'Chin',
          // "Cleft" contains "left" but is no side marker — the old blind swap
          // corrupted it into body_bs_CrightChin. Word-initial "left" still swaps.
          morphs: [
            { id: 'mc1', node: 'Genesis9', prop: 'body_bs_CleftChin', value: 1 },
            { id: 'mc2', node: 'Genesis9', prop: 'thigh_left_up', value: 1 },
          ],
          boneScaleRef: false,
        },
      ],
    }
    const right = mirrorGroup(left)
    expect(right.poses[0].morphs[0].prop).toBe('body_bs_CleftChin')
    expect(right.poses[0].morphs[1].prop).toBe('thigh_right_up')
  })

  it('swaps the case twins: uppercase _L suffix and lowercase l_ prefix', () => {
    const left: RomGroup = {
      id: 'gl',
      // G9 bones are lowercase l_-prefixed — the driver-bone label mirrors too.
      label: 'l_thigh',
      suffix: 'left',
      method: 'individual',
      calculateFrom: 'default',
      poses: [
        {
          id: 'pl',
          name: 'ShldrDown',
          morphs: [
            // Stock Daz JCM naming: the uppercase suffix twin of _l.
            { id: 'm1', node: 'Genesis9', prop: 'pJCMShldrDown_40_L', value: 1 },
            // G9 bone naming: the lowercase prefix twin of L_.
            { id: 'm2', node: 'Genesis9', prop: 'l_thigh', value: 1 },
          ],
          boneScaleRef: false,
        },
      ],
    }
    const right = mirrorGroup(left)
    expect(right.label).toBe('r_thigh')
    expect(right.poses[0].morphs[0].prop).toBe('pJCMShldrDown_40_R')
    expect(right.poses[0].morphs[1].prop).toBe('r_thigh')
  })

  it('swaps mid-name prefix markers after _ or digits symmetrically in both cases', () => {
    const left: RomGroup = {
      id: 'gl',
      label: '',
      suffix: 'left',
      method: 'individual',
      calculateFrom: 'default',
      poses: [
        {
          id: 'pl',
          name: 'Bend',
          morphs: [
            // `_` and digits are word chars, so `\b` never fired here — the
            // uppercase prefix rule must use the same letter-only lookbehind
            // as its lowercase twin.
            { id: 'm1', node: 'Genesis9', prop: 'Foot_L_Bend', value: 1 },
            { id: 'm2', node: 'Genesis9', prop: 'Foot_l_Bend', value: 1 },
            { id: 'm3', node: 'Genesis9', prop: 'x3L_twist', value: 1 },
          ],
          boneScaleRef: false,
        },
      ],
    }
    const right = mirrorGroup(left)
    expect(right.poses[0].morphs[0].prop).toBe('Foot_R_Bend')
    expect(right.poses[0].morphs[1].prop).toBe('Foot_r_Bend')
    expect(right.poses[0].morphs[2].prop).toBe('x3R_twist')
  })

  it('leaves non-marker _L / l_ letter runs untouched (Ball_Large, Curl_lower)', () => {
    const left: RomGroup = {
      id: 'gl',
      label: '',
      suffix: 'left',
      method: 'individual',
      calculateFrom: 'default',
      poses: [
        {
          id: 'pl',
          name: 'Guard',
          morphs: [
            // `_L` continuing into a word is no side marker (would become _Rarge).
            { id: 'mg1', node: 'Genesis9', prop: 'Ball_Large', value: 1 },
            // `l_` preceded by a letter is no bone prefix (would become Curr_lower).
            { id: 'mg2', node: 'Genesis9', prop: 'Curl_lower', value: 1 },
          ],
          boneScaleRef: false,
        },
      ],
    }
    const right = mirrorGroup(left)
    expect(right.poses[0].morphs[0].prop).toBe('Ball_Large')
    expect(right.poses[0].morphs[1].prop).toBe('Curl_lower')
  })
})

describe('genRomStartFrame ↔ presetEndFrame coupling', () => {
  it('derives the same offsets as the single frame-math source', () => {
    // The editor's GEN block starts and presetEndFrame must agree by identity:
    // start('dk') is one past the preset end WITHOUT the GEN/PHY terms, and
    // start('gp') follows the DK block when both ROMs are included.
    const both = makeSections()
    both.GEN.enabled = true
    both.GEN.mode = 'preset'
    both.GEN.presetAssets = ['GP9 - Golden Palace.duf', 'DK9 - Dicktator.duf']
    both.PHY.enabled = true
    both.PHY.mode = 'preset'
    const withoutGenPhy = structuredClone(both)
    withoutGenPhy.GEN.enabled = false
    withoutGenPhy.PHY.enabled = false
    const dkStart = genRomStartFrame(both, 'female', 'dk', FRAMES)
    expect(dkStart).toBe(presetEndFrame(withoutGenPhy, 'female', FRAMES) + 1)
    expect(genRomStartFrame(both, 'female', 'gp', FRAMES)).toBe(dkStart + FRAMES.dk)
    // GP only (no DK): GP starts right after the base ROM.
    const gpOnly = structuredClone(both)
    gpOnly.GEN.presetAssets = ['GP9 - Golden Palace.duf']
    expect(genRomStartFrame(gpOnly, 'female', 'gp', FRAMES)).toBe(
      presetEndFrame(withoutGenPhy, 'female', FRAMES) + 1,
    )
  })
})

describe('buildFbmData', () => {
  it('builds the inline extra-frame payload with 0-based frames', () => {
    const data = buildFbmData(makeCharacter())
    expect(data.meta.version).toBe('1.0')
    // The per-block reset flags are gone: runtime v27 always closes block tails.
    expect('resetGPBeforeApplying' in data.meta).toBe(false)
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
      id: 'mb',
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

  it('every generation that declares a template has a matching template CSV (and vice versa)', () => {
    // GENERATIONS[g].template (the numbers poseAssetCsvValidated reads) and
    // GENERATION_TEMPLATE_CSV (the raw CSV spliceTemplate splices into) must agree
    // on which generations are validated. If one gains a row without the other,
    // poseAssetCsvValidated reports "validated" while toPoseAssetCsv silently emits
    // the experimental custom-only layout (or throws) — a truncated PoseAsset with
    // no warning. Keep the two key sets identical.
    const withTemplate = (Object.keys(GENERATIONS) as Array<GenesisVersion>)
      .filter((g) => GENERATIONS[g].template != null)
      .sort()
    const withCsv = (Object.keys(GENERATION_TEMPLATE_CSV) as Array<GenesisVersion>).sort()
    expect(withCsv).toEqual(withTemplate)
  })
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

  it("splits a JCM rule's signed drives[] into positive/negative by angle sign", () => {
    const character = makeCharacter({
      jcmMorphMods: [
        {
          id: 'rule-1',
          boneLabel: 'Left Thigh',
          axis: 'XRotate',
          drives: [
            { id: 'pos', morphName: 'PosDrive', range: { angle: { start: 0, end: 90 }, value: { start: 0, end: 1 } } },
            { id: 'neg', morphName: 'NegDrive', range: { angle: { start: 0, end: -115 }, value: { start: 0, end: 0.33 } } },
          ],
        },
      ],
    })
    const mod = characterConfig(toCharacterScriptDsa(character).content).jcmMorphMods[0]
    // The stored single list splits back into the runtime's positive/negative lists.
    expect(mod.drives).toBeUndefined()
    expect(mod.positive.map((d: { morphName: string }) => d.morphName)).toEqual(['PosDrive'])
    expect(mod.negative.map((d: { morphName: string }) => d.morphName)).toEqual(['NegDrive'])
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
        morphs: [{ id: 'am1', node: 'Genesis 9', prop: 'GP_Anus_Open', value: 0.9 }],
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

describe('presetFramesSignature', () => {
  // A catalog with BOTH includesFac variants of the JCM base, so the FAC toggle
  // actually flips which base .duf resolveRomPaths picks (the bug the signature
  // must catch: a resolution change without a signature change = stale frames).
  const catalog = {
    folder: 'D:/Lib/DazToHue/Poses',
    assets: [
      { name: 'G9 DQS JCM FAC - Base', relPath: 'G9 DQS JCM FAC - Base.duf', genesis: 'G9' as const, skinning: 'dqs' as const, section: 'JCM' as const, includesFac: true },
      { name: 'G9 DQS JCM - Base', relPath: 'G9 DQS JCM - Base.duf', genesis: 'G9' as const, skinning: 'dqs' as const, section: 'JCM' as const, includesFac: false },
      { name: 'G9 DQS JCM FAC - Mouth', relPath: 'G9 DQS JCM FAC - Mouth.duf', genesis: 'G9' as const, skinning: 'dqs' as const, section: 'FAC' as const, includesFac: false },
      { name: 'GP9 - Golden Palace', relPath: 'GP9 - Golden Palace.duf', genesis: 'G9' as const, skinning: null, section: 'GEN' as const, includesFac: false },
      { name: 'DK9 - Dicktator', relPath: 'DK9 - Dicktator.duf', genesis: 'G9' as const, skinning: null, section: 'GEN' as const, includesFac: false },
      { name: 'G9 Physics', relPath: 'G9 Physics.duf', genesis: 'G9' as const, skinning: null, section: 'PHY' as const, includesFac: false },
    ],
  }
  /** The paths of the blocks that get MEASURED (mouth is resolved but never measured). */
  const measuredPaths = (c: Character) => {
    const { jcm, gp, dk, phys } = resolveRomPaths(c, catalog)
    return { jcm, gp, dk, phys }
  }

  // Every mutation that changes which blocks are measured / which .duf a block
  // resolves to. Each case asserts BOTH sides: the resolution really changed
  // (the case is meaningful) and the signature changed with it (the editor
  // re-measures). A new resolver input added without extending the signature
  // shows up here as a missing case — add both.
  const resolutionChanges: Array<[string, (c: Character) => void]> = [
    ['FAC toggled off picks the FAC-less JCM base', (c) => { c.sections.FAC.enabled = false }],
    ['FAC switched to custom picks the FAC-less JCM base', (c) => { c.sections.FAC.mode = 'custom' }],
    ['JCM disabled drops the base block', (c) => { c.sections.JCM.enabled = false }],
    ['an explicit JCM preset pick overrides the default', (c) => { c.sections.JCM.presetAssets = ['G9 DQS JCM - Base.duf'] }],
    ['GEN enabled adds the GP block', (c) => { c.sections.GEN.enabled = true }],
    ['PHY enabled adds the Physics block', (c) => { c.sections.PHY.enabled = true }],
    ['genesis change resolves against another generation', (c) => { c.genesis = 'G8.1' }],
  ]

  it.each(resolutionChanges)('changes when %s', (_label, mutate) => {
    const before = makeCharacter()
    const after = makeCharacter()
    mutate(after)
    expect(measuredPaths(after)).not.toEqual(measuredPaths(before))
    expect(presetFramesSignature(after)).not.toBe(presetFramesSignature(before))
  })

  it('changes with gender when GEN is enabled (GP ↔ DK)', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    const female = makeCharacter({ sections })
    const male = makeCharacter({ sections, gender: 'male' })
    expect(measuredPaths(male)).not.toEqual(measuredPaths(female))
    expect(presetFramesSignature(male)).not.toBe(presetFramesSignature(female))
  })

  it('changes with the custom JCM asset path (measured directly, not via the catalog)', () => {
    const before = makeCharacter()
    const after = makeCharacter()
    after.sections.JCM.mode = 'custom'
    after.sections.JCM.customAssetPath = 'X:/my/Custom Base.duf'
    expect(presetFramesSignature(after)).not.toBe(presetFramesSignature(before))
  })

  it('ignores edits that cannot affect the preset blocks (no spurious re-measures)', () => {
    const before = makeCharacter()
    const after = makeCharacter({ name: 'Renamed', facsDetailStrength: 0.5 })
    after.sections.EXP.enabled = true
    after.sections.FBM.groups[0].poses[0].name = 'Edited'
    expect(presetFramesSignature(after)).toBe(presetFramesSignature(before))
  })
})

describe('boneScaleRefPoses — the single reference-FBX rule', () => {
  it('drives referenceFrames one-to-one; a bone-scale flag outside GEN/FBM stays inert', () => {
    const sections = makeSections()
    sections.FBM.groups[0].poses[0].boneScaleRef = true
    // A stray flag on a MISC pose must not produce a reference frame (a file
    // column on a MIS row breaks the HDA's import_from_csv).
    sections.MISC.enabled = true
    sections.MISC.mode = 'custom'
    sections.MISC.groups = [
      {
        id: 'm1',
        label: '',
        suffix: 'centre',
        method: 'individual',
        calculateFrom: 'default',
        poses: [{ id: 'mp', name: 'Odd', morphs: [], boneScaleRef: true }],
      },
    ]
    const walks = boneScaleRefPoses(sections)
    expect(walks.map((w) => [w.section, w.pose.name])).toEqual([['FBM', 'BodyTone']])
    // referenceFrames = the same walks at their absolute frames — by construction.
    const character = makeCharacter({ sections })
    expect(referenceFrames(character, FRAMES)).toEqual(
      walks.map((w) => presetEndFrame(sections, 'female', FRAMES) + 1 + w.relativeFrame),
    )
  })
})

describe('sectionPresetAvailable — availability matches resolveRomPaths resolution', () => {
  // Two catalogs: a full G9 release, and a sparse one (FAC-less linear JCM base
  // only — no GEN, no PHY). For every preset-backed section, "available" must
  // agree with "resolveRomPaths actually yields the block's path": the chip in
  // the editor and the resolution in generation are two views of ONE rule.
  const rich = {
    folder: 'D:/P',
    assets: [
      { name: 'G9 DQS JCM FAC - Base', relPath: 'a.duf', genesis: 'G9' as const, skinning: 'dqs' as const, section: 'JCM' as const, includesFac: true },
      { name: 'G9 DQS JCM FAC - Mouth', relPath: 'b.duf', genesis: 'G9' as const, skinning: 'dqs' as const, section: 'FAC' as const, includesFac: false },
      { name: 'GP9 - Golden Palace', relPath: 'c.duf', genesis: 'G9' as const, skinning: null, section: 'GEN' as const, includesFac: false },
      { name: 'DK9 - Dicktator', relPath: 'd.duf', genesis: 'G9' as const, skinning: null, section: 'GEN' as const, includesFac: false },
      { name: 'G9 Physics', relPath: 'e.duf', genesis: 'G9' as const, skinning: null, section: 'PHY' as const, includesFac: false },
    ],
  }
  const sparse = {
    folder: 'D:/P',
    assets: [
      { name: 'G9 LINEAR JCM - Base', relPath: 'f.duf', genesis: 'G9' as const, skinning: 'linear' as const, section: 'JCM' as const, includesFac: false },
    ],
  }
  // section → the RomPaths key its preset resolves to (GEN female → GP).
  const CASES = [
    ['JCM', 'jcm'],
    ['FAC', 'mouth'],
    ['GEN', 'gp'],
    ['PHY', 'phys'],
  ] as const

  for (const [catalogName, catalog] of [['rich', rich], ['sparse', sparse]] as const) {
    it(`agrees with the resolved paths for the ${catalogName} catalog`, () => {
      for (const [section, pathKey] of CASES) {
        const sections = makeSections()
        sections[section].enabled = true
        sections[section].mode = 'preset'
        const character = makeCharacter({ sections })
        const available = sectionPresetAvailable(
          section,
          catalog,
          'G9',
          'female',
          sections[section].presetAssets,
        )
        const resolved = resolveRomPaths(character, catalog)[pathKey] !== undefined
        expect(available, `${section} availability vs resolution`).toBe(resolved)
      }
    })
  }

  it('reports available on an EMPTY catalog (unknown must not lock the editor)', () => {
    expect(sectionPresetAvailable('GEN', { assets: [] }, 'G9', 'female', [])).toBe(true)
  })
})

describe('facPresetSupport — availability and mouth resolution are ONE rule', () => {
  // The two catalogs where the old pair of signals (availability: a JCM base
  // with includesFac; mouth resolution: any FAC-section asset) DIVERGED.
  const jcmBase = (includesFac: boolean) => ({
    name: includesFac ? 'G9 DQS JCM FAC - Base' : 'G9 DQS JCM - Base',
    relPath: includesFac ? 'fac-base.duf' : 'base.duf',
    genesis: 'G9' as const,
    skinning: 'dqs' as const,
    section: 'JCM' as const,
    includesFac,
  })
  const mouth = {
    name: 'G9 DQS JCM FAC - Mouth',
    relPath: 'mouth.duf',
    genesis: 'G9' as const,
    skinning: 'dqs' as const,
    section: 'FAC' as const,
    includesFac: false,
  }
  /** FAC-section mouth shipped, but every JCM base is FAC-less. */
  const mouthNoFacBase = { folder: 'D:/P', assets: [jcmBase(false), mouth] }
  /** FAC-capable base shipped, but no FAC-section (mouth) asset — the G8.1 shape. */
  const facBaseNoMouth = { folder: 'D:/P', assets: [jcmBase(true)] }

  it('a mouth without any FAC-capable base: unavailable AND no mouth resolves', () => {
    // The mouth companion only adds mouth-node keys over base FAC frames — with
    // no base carrying them, resolving it would hand the runtime a mouth pass
    // over frames that don't exist.
    expect(facPresetSupport(mouthNoFacBase.assets, 'G9').available).toBe(false)
    expect(sectionPresetAvailable('FAC', mouthNoFacBase, 'G9', 'female', [])).toBe(false)
    const paths = resolveRomPaths(makeCharacter(), mouthNoFacBase)
    expect(paths.jcm).toContain('base.duf')
    expect(paths.mouth).toBeUndefined()
  })

  it('a FAC-capable base without a mouth: available, with simply no companion', () => {
    expect(facPresetSupport(facBaseNoMouth.assets, 'G9').available).toBe(true)
    expect(sectionPresetAvailable('FAC', facBaseNoMouth, 'G9', 'female', [])).toBe(true)
    const paths = resolveRomPaths(makeCharacter(), facBaseNoMouth)
    expect(paths.jcm).toContain('fac-base.duf')
    expect(paths.mouth).toBeUndefined()
  })

  it('custom-JCM mouth resolution consumes the same rule (no FAC base → no mouth)', () => {
    const sections = makeSections()
    sections.JCM.mode = 'custom'
    sections.JCM.customAssetPath = 'D:/lib/My Base.duf'
    const character = makeCharacter({ sections })
    expect(resolveRomPaths(character, mouthNoFacBase).mouth).toBeUndefined()
    // With a FAC-capable base in the catalog the companion resolves as before.
    const withBoth = { folder: 'D:/P', assets: [jcmBase(true), mouth] }
    expect(resolveRomPaths(character, withBoth).mouth).toContain('mouth.duf')
  })
})

describe('bIncludeFAC ↔ frame contribution (FAC rides in the JCM base)', () => {
  it('FAC preset with JCM disabled emits bIncludeFAC false (no base = no FAC frames)', () => {
    const sections = makeSections()
    sections.JCM.enabled = false // FAC stays enabled+preset from defaults
    const config = characterConfig(toCharacterScriptDsa(makeCharacter({ sections }), {}, FRAMES).content)
    expect(config.bIncludeJCM).toBe(false)
    expect(config.bIncludeFAC).toBe(false)
  })

  it('a custom JCM base .duf still counts as a base for FAC', () => {
    const sections = makeSections()
    sections.JCM.mode = 'custom'
    sections.JCM.customAssetPath = 'D:/lib/My Base.duf'
    const config = characterConfig(toCharacterScriptDsa(makeCharacter({ sections })).content)
    expect(config.bIncludeFAC).toBe(true)
  })

  it('never emits mouthRomPath when bIncludeFAC is off', () => {
    const sections = makeSections()
    sections.JCM.enabled = true
    sections.JCM.mode = 'custom'
    sections.JCM.customAssetPath = '' // custom without a base .duf → no base ROM
    const config = characterConfig(
      toCharacterScriptDsa(makeCharacter({ sections }), { mouth: 'P/Mouth.duf' }).content,
    )
    expect(config.bIncludeFAC).toBe(false)
    expect(config.mouthRomPath).toBeUndefined()
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
        morphs: [{ id: 'am1', node: 'Genesis 9', prop: 'GP_Anus_Open', value: 0.9 }],
      },
      { id: 'a2', rom: 'gp', frame: 96, name: 'VaginaOpen', morphs: [] },
    ]
    const character = makeCharacter({ sections })
    const json = buildArtDirectionData(character, 'gp', 'GP9', 'Golden Palace')
    // Empty frames are skipped — only AnusOpen survives. toEqual is exact: the
    // stored morph id ('am1', schema v19) must NOT reach the emitted payload.
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

  it('drops art-direction frames that key at or beyond the measured block length', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    sections.GEN.artDirection = [
      // In-range (GP block is 104): kept.
      { id: 'ok', rom: 'gp', frame: 100, name: 'AnusOpen', morphs: [{ id: 'aok', node: 'Genesis 9', prop: 'GP_Anus_Open', value: 0.9 }] },
      // >= 104: would stamp at gpStart+5000, deep in the custom-frame range,
      // corrupting a custom pose's deltas. Must be dropped.
      { id: 'oob', rom: 'gp', frame: 5000, name: 'Bogus', morphs: [{ id: 'abo', node: 'Genesis 9', prop: 'GP_Bogus', value: 1 }] },
    ]
    const character = makeCharacter({ sections })
    const json = buildArtDirectionData(character, 'gp', 'GP9', 'Golden Palace', FRAMES.gp)
    expect(json?.frames.map((f) => f.name)).toEqual(['AnusOpen'])
    // Unbounded (no measured length) keeps both — the pure/web path where the
    // runtime fails loud rather than guessing.
    const unbounded = buildArtDirectionData(character, 'gp', 'GP9', 'Golden Palace')
    expect(unbounded?.frames).toHaveLength(2)
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
          { id: 'p1', name: 'BallBD40', morphs: [], boneScaleRef: false },
          { id: 'p2', name: 'BallBU60', morphs: [], boneScaleRef: false },
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

  it('emits a GROUP header per group — MULTIPLE groups in one section, frames continuous', () => {
    // A section with several groups must emit one header row per group, each
    // BEFORE its first pose, with the pose frames running continuously across
    // the group boundary (the header rows carry no frame).
    const sections = makeSections()
    sections.EXP.enabled = true
    sections.EXP.groups = [
      {
        id: 'e1',
        label: '',
        suffix: 'left',
        method: 'individual',
        calculateFrom: 'default',
        poses: [
          { id: 'e1p1', name: 'BrowUp', morphs: [], boneScaleRef: false },
          { id: 'e1p2', name: 'BrowDown', morphs: [], boneScaleRef: false },
        ],
      },
      {
        id: 'e2',
        label: '',
        suffix: 'right',
        method: 'additive',
        calculateFrom: 'restPose',
        poses: [{ id: 'e2p1', name: 'EyeClosed', morphs: [], boneScaleRef: false }],
      },
    ]
    const file = toPoseAssetCsv(makeCharacter({ sections }), FRAMES, '2.0')
    const lines = file.content.trimEnd().split('\n')
    const start = lines.indexOf('EXPGROUP,0,1,0')
    expect(start).toBeGreaterThan(-1)
    expect(lines.slice(start, start + 5)).toEqual([
      'EXPGROUP,0,1,0', // calc default, method individual, suffix left
      'EXP,328,BrowUp',
      'EXP,329,BrowDown',
      'EXPGROUP,1,2,2', // calc restPose, method additive, suffix right
      'EXP,330,EyeClosed',
    ])
    // The following flat FBM section continues right after — no frame skipped.
    expect(lines).toContain('FBM,331,BodyTone,')
  })

  it('a male/DK character continues custom frames after base+dk (the dk term pinned)', () => {
    // The dk term of presetEndFrame is where the one historical frame-math crack
    // lived (a base+gp splice that lacked it). A G9 male with the Dicktator block
    // falls to the experimental path (the G9 template bakes no DK), so custom rows
    // continue right after base(328)+dk(54)=382.
    const sections = makeSections()
    sections.GEN.enabled = true
    sections.GEN.presetAssets = ['DK9 - Dicktator.duf']
    const character = makeCharacter({ gender: 'male', sections })
    const file = toPoseAssetCsv(character, FRAMES, '2.0')
    expect(file.experimental).toBe(true)
    const first = file.content.trimEnd().split('\n').find((l) => l.startsWith('FBM,'))
    expect(first).toBe('FBM,382,BodyTone,')
    // referenceFrames derives from the SAME offset — alignment by construction.
    const refSections = makeSections()
    refSections.GEN.enabled = true
    refSections.GEN.presetAssets = ['DK9 - Dicktator.duf']
    refSections.FBM.groups[0].poses[0].boneScaleRef = true
    const refChar = makeCharacter({ gender: 'male', sections: refSections })
    expect(referenceFrames(refChar, FRAMES)[0]).toBe(382)
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
              poses: [{ id: 'r', name: 'Ref', morphs: [], boneScaleRef: true }],
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

  it('escapes U+2028/U+2029 in embedded strings (Daz treats them as line terminators)', () => {
    // Built via fromCharCode — the literal characters are line terminators in
    // THIS source too.
    const sep = String.fromCharCode(0x2028)
    const evil = `Kira${sep}DzFile("x").remove(); //`
    const content = toCharacterScriptDsa(makeCharacter({ name: evil }), {}, FRAMES).content
    // Raw, the separator would END the generated string literal mid-line and the
    // whole script would fail to parse (comments were already hardened; the
    // JSON-embedded strings were not).
    expect(content.includes(sep)).toBe(false)
    expect(content.includes(String.fromCharCode(0x2029))).toBe(false)
    expect(content).toContain('\\u2028') // survives as DATA inside the string
    // Still parseable: the config extractor finds valid JSON.
    expect(characterConfig(content).characterName).toContain('Kira')
  })

  it('the exporter call and the CSV reference paths share one sanitized figure name', () => {
    const sections = makeSections()
    sections.JCM.enabled = false
    sections.GEN.enabled = false
    sections.FBM.groups[0].poses[0].boneScaleRef = true
    const character = makeCharacter({ name: 'A,B', sections, exportPath: 'D:/Exports' })
    // CSV side: the comma is normalized to a space in the reference-FBX path…
    const csv = toPoseAssetCsv(character, FRAMES).content
    expect(csv).toContain('Reference Skeletons/A B_frame_')
    // …and doExport receives the SAME name, so the exporter writes the file the
    // CSV points at (previously it got the raw "A,B" and the paths diverged).
    const script = toCharacterScriptDsa(character, {}, FRAMES).content
    expect(script).toContain('doExport(dthExportDir, "A B",')
  })

  it('strips Windows-illegal filename chars from the reference-FBX figure name', () => {
    const sections = makeSections()
    sections.JCM.enabled = false
    sections.GEN.enabled = false
    sections.FBM.groups[0].poses[0].boneScaleRef = true
    // `"` and `:` are legal in a character name but forbidden in a Windows file
    // name — the exporter's `<name>_frame_N.fbx` write would fail/mangle while the
    // CSV pointed at the clean name.
    const character = makeCharacter({ name: 'Kira "Beach": v2', sections, exportPath: 'D:/Exports' })
    const csv = toPoseAssetCsv(character, FRAMES).content
    const ref = csv.split('\n').find((l) => l.includes('Reference Skeletons/')) ?? ''
    expect(ref).not.toMatch(/["<>:*?|\\]/)
    // The CSV path and the doExport name still match (single source).
    const figure = ref.match(/Reference Skeletons\/(.+)_frame_/)?.[1] ?? ''
    expect(toCharacterScriptDsa(character, {}, FRAMES).content).toContain(
      `doExport(dthExportDir, "${figure}",`,
    )
  })

  it('a custom PHY section flags the CSV experimental (physics payload not modeled)', () => {
    // The schema carries no offset/radius/push-XYZ for custom PHY rows yet, so a
    // custom PHY block must not ship as validated ground truth.
    expect(toPoseAssetCsv(makeCharacter(), FRAMES, '2.0').experimental).toBeUndefined()
    const sections = makeSections()
    sections.PHY.enabled = true
    sections.PHY.mode = 'custom'
    sections.PHY.groups = [{ ...fbmGroup(), id: 'phy1' }]
    expect(toPoseAssetCsv(makeCharacter({ sections }), FRAMES, '2.0').experimental).toBe(true)
  })

  it('sanitizes commas/newlines out of CSV group labels', () => {
    const sections = makeSections()
    sections.JCM.mode = 'custom'
    sections.JCM.groups = [
      {
        id: 'g',
        label: 'evil,label\ninjected',
        suffix: 'left',
        method: 'individual',
        calculateFrom: 'default',
        poses: [{ id: 'p', name: 'Pose', morphs: [], boneScaleRef: false }],
      },
    ]
    const rows = toPoseAssetCsv(makeCharacter({ sections }), FRAMES).content.split('\n')
    const group = rows.find((r) => r.startsWith('JCMGROUP')) ?? ''
    expect(group).toBe('JCMGROUP,1,0,evil label injected') // comma + newline → space
    expect(rows.every((r) => !r.includes('\n'))).toBe(true)
  })

  it('a bone-scale frame emits the reference-FBX token path in the CSV file column', () => {
    const sections = makeSections()
    sections.JCM.enabled = false
    sections.GEN.enabled = false
    sections.FBM.groups[0].poses[0].boneScaleRef = true
    const character = makeCharacter({ name: 'Karen', sections })
    const fbmRows = toPoseAssetCsv(character, FRAMES)
      .content.split('\n')
      .filter((r) => r.startsWith('FBM,'))
    const ref = fbmRows.find((r) => r.includes('{{DTH_EXPORT_DIR}}')) ?? ''
    const frame = ref.split(',')[1]
    // Filename matches what the DTH Exporter writes, under a Reference Skeletons subdir.
    expect(ref).toContain(`{{DTH_EXPORT_DIR}}/Reference Skeletons/Karen_frame_${frame}.fbx`)
    // Non-bone-scale FBM rows keep an empty file column.
    expect(fbmRows.filter((r) => r.endsWith(',')).length).toBeGreaterThan(0)
  })

  it('a bone-scale flag on a MISC pose stays inert — MIS rows never carry a file', () => {
    // A non-empty file on a MIS row makes the HDA's import_from_csv fail (the
    // parser reads the column but the node has no Misc reference-FBX parameter,
    // measured on 2.4.3) — so only GEN/FBM may emit reference paths/frames.
    const sections = makeSections()
    sections.JCM.enabled = false
    sections.GEN.enabled = false
    sections.FBM.groups[0].poses[0].boneScaleRef = true
    sections.MISC.enabled = true
    sections.MISC.groups = [
      {
        ...fbmGroup(),
        id: 'm1',
        poses: [{ id: 'm', name: 'TorsoLength', morphs: [], boneScaleRef: true }],
      },
    ]
    const character = makeCharacter({ name: 'Karen', sections })
    const rows = toPoseAssetCsv(character, FRAMES).content.split('\n')
    const misRows = rows.filter((r) => r.startsWith('MIS,'))
    expect(misRows.length).toBeGreaterThan(0)
    expect(misRows.every((r) => r.endsWith(','))).toBe(true) // empty file column
    // The exporter gets only the FBM reference frame — the flagged MISC pose is excluded.
    const fbmRef = rows.find((r) => r.startsWith('FBM,') && r.includes('{{DTH_EXPORT_DIR}}')) ?? ''
    expect(referenceFrames(character, FRAMES)).toEqual([Number(fbmRef.split(',')[1])])
  })
})

// Finding 2: the G9 gate pins the baked block lengths (base 328, GP 104, phys 43)
// the same way the G8.1 gate pins 188 — a base/GP/phys that measures differently
// (a future or custom asset) can't silently splice custom rows at the wrong
// offset; it falls to the experimental custom-only path instead.
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

  it('an UNMEASURED GP with GP included is not validated (same polarity as the base)', () => {
    // A dead `gpFrames !== undefined` escape used to wave an unmeasured GP
    // through as validated — the opposite polarity of the base check. Every
    // caller measures gp, so unmeasured now uniformly means "not validated".
    const sections = makeSections()
    sections.GEN.enabled = true
    const character = makeCharacter({ sections })
    expect(poseAssetCsvValidated(character, '2.0', 328)).toBe(false)
    expect(poseAssetCsvValidated(character, '2.0', 328, 104)).toBe(true)
    // GP not included → the gp measurement stays irrelevant either way.
    expect(poseAssetCsvValidated(makeCharacter(), '2.0', 328, undefined)).toBe(true)
  })

  it('stays experimental when PHY preset is on but the physics block measures ≠ 43', () => {
    // The fixed PHY block splices as 43 baked rows renumbered from
    // presetEndFrame — a physics asset that measures differently would shift
    // every custom frame after it, so it de-validates the CSV instead.
    const sections = makeSections()
    sections.PHY.enabled = true
    sections.PHY.mode = 'preset'
    const file = toPoseAssetCsv(makeCharacter({ sections }), { ...FRAMES, phys: 40 }, '2.0')
    expect(file.experimental).toBe(true)
  })

  it('ignores the phys length when PHY is off (no physics block is spliced)', () => {
    expect(toPoseAssetCsv(makeCharacter(), { ...FRAMES, phys: 40 }, '2.0').experimental).toBeUndefined()
  })

  it('an UNMEASURED phys with PHY preset on is not validated (same polarity as base/GP)', () => {
    const sections = makeSections()
    sections.PHY.enabled = true
    sections.PHY.mode = 'preset'
    const character = makeCharacter({ sections })
    expect(poseAssetCsvValidated(character, '2.0', 328, undefined)).toBe(false)
    expect(poseAssetCsvValidated(character, '2.0', 328, undefined, 43)).toBe(true)
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
    {
      // GP/PHY preset blocks WITHOUT a base ROM: presetEndFrame starts from -1
      // (no base) and still sums the gp + phys terms, so the first custom frame
      // lands at 104 + 43 = 147 in BOTH artifacts.
      label: 'base-less GEN + PHY (preset blocks without a base ROM)',
      patch: (s) => {
        s.JCM.enabled = false
        s.FAC.enabled = false
        s.GEN.enabled = true
        s.PHY.enabled = true
        s.PHY.mode = 'preset'
      },
    },
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
    sections.FBM.groups[0].poses[0].boneScaleRef = true
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
    // A read-replace-write (not a move): the source survives for the next scene's
    // export, and the {{DTH_EXPORT_DIR}} token resolves to the real run-time dir.
    expect(content).toContain('dthCsvText.split("{{DTH_EXPORT_DIR}}").join(dthExportDir)')
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
    expect(exportScript.content).toContain('dthCsvText.split("{{DTH_EXPORT_DIR}}").join(dthExportDir)')

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

describe('groom items (hair kept out of the export)', () => {
  const groomChar = (over: Partial<Character> = {}) =>
    makeCharacter({
      name: 'Electra',
      exportPath: 'X:\\exports\\electra',
      groomScenes: [
        { scenePath: 'X:\\scenes\\Karen.duf', nodes: [{ nodeLabel: 'dForce Black Tie Cap' }] },
      ],
      ...over,
    })

  it('embeds the per-scene map and brackets the export with hide → run → show', () => {
    const content = toCharacterScriptDsa(groomChar(), {}, FRAMES, 'D:\\lib\\Electra').content
    // The whole map is baked in (normalized keys); the OPEN scene resolves at run time.
    expect(content).toContain('"x:/scenes/karen.duf":["dForce Black Tie Cap"]')
    expect(content).toContain('String(Scene.getFilename()).split(')
    // No entry for the open scene → export as-is (a scene without groom is valid).
    expect(content).toContain('No hair list for the open scene - exporting as-is.')
    // HIDE → export → show. The DTH Exporter Plugin unparents any hidden child
    // node before exporting, so hiding excludes the groom from BOTH artifacts —
    // the script no longer unfit+unparents itself.
    const hideAt = content.indexOf('dthGroomHideTree(dthGroomNodes[dthGd])')
    const runAt = content.indexOf('dthRunExport();', hideAt)
    const restoreAt = content.indexOf('.setVisible(true)', runAt)
    expect(hideAt).toBeGreaterThan(-1)
    expect(runAt).toBeGreaterThan(hideAt)
    expect(restoreAt).toBeGreaterThan(runAt)
    // The detach path is gone — the script never touches parenting/fit anymore.
    expect(content).not.toContain('setFollowTarget(null)')
    expect(content).not.toContain('removeNodeChild(')
    // Restore runs even when the export throws; the CSV delivery rides inside.
    expect(content).toContain('} finally {')
    expect(content).toContain('dthCsvSrcDir')
  })

  it('brackets the split Export_ script with the same hide bracket', () => {
    const split = generateAll(
      groomChar({ exportWithRomScript: false }),
      {},
      FRAMES,
      'D:\\lib\\Electra',
    ).find((f) => f.fileName === 'Export_Electra_G9.dsa')
    expect(split?.content).toContain('dthGroomHideTree(dthGroomNodes[dthGd])')
    expect(split?.content).not.toContain('setFollowTarget(null)')
  })

  it('a missing groom item skips the export loud instead of shipping hair', () => {
    const content = toCharacterScriptDsa(groomChar(), {}, FRAMES).content
    expect(content).toContain('if (!dthGroomNode) { dthGroomMissing = dthGroomLabels[dthGi]; break; }')
    expect(content).toContain('was not found in the scene')
  })

  it('emits no groom code without groom items, and blank labels count as none', () => {
    const plain = makeCharacter({ name: 'Electra', exportPath: 'X:\\exports\\electra' })
    expect(toCharacterScriptDsa(plain, {}, FRAMES).content).not.toContain('dthGroom')
    const blank = groomChar({
      groomScenes: [{ scenePath: 'X:\\scenes\\Karen.duf', nodes: [{ nodeLabel: '  ' }] }],
    })
    expect(toCharacterScriptDsa(blank, {}, FRAMES).content).not.toContain('dthGroom')
  })

  it('generateAll emits the groom script only with an export path AND groom lists', () => {
    expect(generateAll(groomChar(), {}, FRAMES, 'D:\\lib\\Electra').map((f) => f.fileName)).toEqual([
      'ROM_Electra_G9.dsa',
      'Export_Hair_Electra_G9.dsa',
      'Electra_pose_asset.csv',
    ])
    expect(generateAll(groomChar({ exportPath: '' }), {}, FRAMES).map((f) => f.fileName)).toEqual([
      'ROM_Electra_G9.dsa',
      'Electra_pose_asset.csv',
    ])
  })

  it('the groom script exports each hair item on its own via the DOCUMENTED 3-arg export', () => {
    const script = toGroomExportScriptDsa(groomChar())
    expect(script.fileName).toBe('Export_Hair_Electra_G9.dsa')
    expect(script.content).toContain('"x:/scenes/karen.duf":["dForce Black Tie Cap"]')
    // Byte-identity of the emitted scene-lookup fold (backslash escapes intact):
    // the Daz-side `.split("\\")` must reach the script as exactly two
    // characters — an escaping regression here silently breaks the scene-path
    // match and the groom list resolves to [] for every scene.
    expect(script.content).toContain(
      '    var dthGroomByScene = {"x:/scenes/karen.duf":["dForce Black Tie Cap"]};\n' +
        '    var dthGroomScene = String(Scene.getFilename()).split("\\\\").join("/").toLowerCase();\n' +
        '    var dthGroomLabels = dthGroomByScene[dthGroomScene] || [];',
    )
    // Per-item: loops the open scene's hair list, exporting each on its own as
    // "<Name>_Hair_<item>" (the 2-arg call crashes Daz — false is mandatory).
    expect(script.content).toContain('for (var dthGi = 0; dthGi < dthGroomLabels.length; dthGi++)')
    expect(script.content).toContain('var dthHairName = "Electra_Hair_" + dthHairSlug(dthKeepLabel)')
    expect(script.content).toContain('doExportAlembicGroomPoses(dthExportDir, dthHairName, false)')
    expect(script.content).not.toContain('"Electra_groom"')
    expect(script.content).toContain('} finally {')
  })
})

describe('templateBakedPoseNames — the names the preset blocks reserve', () => {
  it('collects baked names with their group suffix applied, matching the CSV rows', () => {
    const names = templateBakedPoseNames(makeCharacter())
    // Flat RET rows (before any group header) carry no suffix.
    expect(names).toContain('RestPose')
    expect(names).toContain('UnrealPose')
    // JCMGROUP,0,0,ball_l is a LEFT group → its poses resolve with _l.
    expect(names).toContain('BallBD40_l')
    // GEN excluded while GP is off.
    expect(names.some((n) => n.startsWith('Fence'))).toBe(false)
  })

  it('includes the GP rows when GP is included and the PHY block when physics is on', () => {
    const sections = makeSections()
    sections.GEN.enabled = true
    sections.PHY.enabled = true
    sections.PHY.mode = 'preset'
    const names = templateBakedPoseNames(makeCharacter({ sections }))
    // GENGROUP,0,0,1 (centre) precedes ClitorisErect → no suffix.
    expect(names).toContain('ClitorisErect')
    // The physics block's first group is LEFT (PHYGROUP,0,0,breast_l).
    expect(names).toContain('BreastOut_l')
  })

  it('is empty when no validated template applies (experimental layouts ship no baked rows)', () => {
    const sections = makeSections()
    sections.JCM.enabled = false
    expect(templateBakedPoseNames(makeCharacter({ sections }))).toEqual([])
    expect(templateBakedPoseNames(makeCharacter({ genesis: 'G8' }))).toEqual([])
  })

  it('feeds romValidationErrors: a custom FBM pose named after a baked GP pose is flagged', () => {
    // The finding-13c scenario: with GP included, a custom FBM pose called
    // "Fence01" would silently overwrite the baked GP morph in Unreal.
    const sections = makeSections()
    sections.GEN.enabled = true
    sections.FBM.groups[0].poses[0].name = 'Fence01'
    sections.FBM.groups[0].poses[1].name = 'GluteUpDown' // Houdini-safe name
    const character = makeCharacter({ sections })
    const errs = romValidationErrors(character.sections, templateBakedPoseNames(character))
    expect(errs).toHaveLength(1)
    expect(errs[0]).toMatchObject({ section: 'FBM', field: 'name', relativeFrame: 0 })
    expect(errs[0].message).toMatch(/preset ROM/i)
    // Without GP the GEN names are not reserved — the same pose is fine.
    const noGp = makeSections()
    noGp.FBM.groups[0].poses[0].name = 'Fence01'
    noGp.FBM.groups[0].poses[1].name = 'GluteUpDown'
    const plain = makeCharacter({ sections: noGp })
    expect(romValidationErrors(plain.sections, templateBakedPoseNames(plain))).toEqual([])
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
