import { describe, expect, it } from 'vitest'

import { buildFbmData } from './generate'
import {
  CHARACTER_SCHEMA_VERSION,
  MIN_GROOM_EXPORTER_VERSION,
  ROM_SECTIONS,
  artDirectionFrameSchema,
  characterSchema,
  characterSkinning,
  compareDthVersions,
  defaultSectionMode,
  defaultSections,
  exporterSupportsGroomHide,
  genesisFigureNode,
  poseAssetCsvEra,
} from './types'

const base = {
  id: 'abc',
  name: 'Electra',
  genesis: 'G9',
  gender: 'female',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('character schema version', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(CHARACTER_SCHEMA_VERSION)).toBe(true)
    expect(CHARACTER_SCHEMA_VERSION).toBeGreaterThanOrEqual(1)
  })

  it('defaults a missing schemaVersion to the baseline (1), not the live constant', () => {
    // Pre-versioning JSONs have no schemaVersion; they must read as 1 so a future
    // bump leaves them correctly *below* the current version (a migration target).
    const character = characterSchema.parse(base)
    expect(character.schemaVersion).toBe(1)
  })

  it('preserves an explicitly stored schemaVersion', () => {
    const character = characterSchema.parse({ ...base, schemaVersion: 3 })
    expect(character.schemaVersion).toBe(3)
  })
})

describe('project provenance fields', () => {
  it('default to empty when absent (pre-v2 JSONs)', () => {
    const character = characterSchema.parse(base)
    expect(character.projectName).toBe('')
    expect(character.projectPath).toBe('')
  })

  it('preserve stored project name + path', () => {
    const character = characterSchema.parse({
      ...base,
      projectName: 'Default',
      projectPath: 'X:/_3d/dth-characters',
    })
    expect(character.projectName).toBe('Default')
    expect(character.projectPath).toBe('X:/_3d/dth-characters')
  })
})

describe('generatedDthVersion (v7, additive)', () => {
  it('defaults to empty when absent (pre-v7 JSONs) — needs no migration step', () => {
    expect(characterSchema.parse(base).generatedDthVersion).toBe('')
  })

  it('preserves the stored value', () => {
    expect(characterSchema.parse({ ...base, generatedDthVersion: '2.4.3' }).generatedDthVersion).toBe(
      '2.4.3',
    )
  })
})

describe('string bounds (hostile shared JSONs)', () => {
  it('parses a realistic character untouched', () => {
    const character = characterSchema.parse({
      ...base,
      image: 'Electra.png',
      scenePath: 'X:\\_3d\\dth-characters\\Electra\\daz3d\\ElectraDefault_G9.duf',
      extraScenes: ['X:\\_3d\\dth-characters\\Electra\\daz3d\\ElectraSummer_G9.duf'],
      houdiniProjects: ['X:\\_3d\\dth-characters\\Electra\\houdini\\Electra.hip'],
      preserveMorphs: [{ name: 'body_bs_BreastsPosition', keepValue: 0.5 }],
      products: [
        {
          name: 'Golden Palace for Genesis 9',
          artist: 'Meipe',
          usedBy: 'GoldenPalace_G9; GP Shell',
          scenes: ['ElectraDefault_G9'],
        },
      ],
    })
    expect(character.name).toBe('Electra')
    expect(character.products[0].artist).toBe('Meipe')
  })

  it('rejects an absurd multi-megabyte string field', () => {
    const bomb = 'x'.repeat(5 * 1024 * 1024) // 5 MB
    expect(characterSchema.safeParse({ ...base, scenePath: bomb }).success).toBe(false)
    expect(characterSchema.safeParse({ ...base, name: bomb }).success).toBe(false)
    expect(characterSchema.safeParse({ ...base, image: bomb }).success).toBe(false)
  })

  it('keeps a data: URL image within the generous image bound', () => {
    // canonicalImage keeps data: URLs verbatim — the image bound must not
    // reject a reasonable inline avatar.
    const dataUrl = `data:image/png;base64,${'A'.repeat(100_000)}`
    expect(characterSchema.safeParse({ ...base, image: dataUrl }).success).toBe(true)
  })
})

describe('artDirection frame offsets', () => {
  const ad = { id: 'a', rom: 'gp', frame: 100, name: 'AnusOpen', morphs: [] }

  it('accepts whole non-negative offsets', () => {
    expect(artDirectionFrameSchema.safeParse(ad).success).toBe(true)
    expect(artDirectionFrameSchema.safeParse({ ...ad, frame: 0 }).success).toBe(true)
  })

  it('rejects fractional and negative offsets (they would key into a neighboring block)', () => {
    expect(artDirectionFrameSchema.safeParse({ ...ad, frame: 2.5 }).success).toBe(false)
    expect(artDirectionFrameSchema.safeParse({ ...ad, frame: -1 }).success).toBe(false)
  })
})

describe('sections schema (SECTION_MODES enforcement + healing)', () => {
  it('rejects a section in a mode it does not support (RET custom would shift every custom frame)', () => {
    const result = characterSchema.safeParse({
      ...base,
      sections: { RET: { enabled: true, mode: 'custom' } },
    })
    expect(result.success).toBe(false)
  })

  it('heals missing section keys to their defaults instead of hard-failing', () => {
    const character = characterSchema.parse({
      ...base,
      // A hand-edited file carrying only one section: the others fill in.
      sections: { FBM: { enabled: true, mode: 'custom' } },
    })
    expect(character.sections.RET.mode).toBe('preset')
    expect(character.sections.JCM.enabled).toBe(true)
    expect(character.sections.FBM.enabled).toBe(true)
  })

  it('heals a PARTIAL section object (missing mode) to that SECTION’s default mode', () => {
    // Sub-key granularity: `{ RET: { enabled: true } }` used to heal mode to the
    // global 'custom' default — which the SECTION_MODES superRefine then
    // rejected, hard-failing the whole character over a healable omission.
    const character = characterSchema.parse({
      ...base,
      sections: { RET: { enabled: true }, GEN: { enabled: true } },
    })
    expect(character.sections.RET.mode).toBe('preset')
    // Partial GEN heals to its preset-first default, not a silently different
    // (empty custom) ROM.
    expect(character.sections.GEN.mode).toBe('preset')
    // Custom-only sections keep healing to custom.
    const fbm = characterSchema.parse({ ...base, sections: { FBM: { enabled: true } } })
    expect(fbm.sections.FBM.mode).toBe('custom')
  })

  it('the schema’s per-section mode default mirrors defaultSections() for every section', () => {
    const defaults = defaultSections()
    for (const section of ROM_SECTIONS) {
      const parsed = characterSchema.parse({ ...base, sections: { [section]: {} } })
      expect(parsed.sections[section].mode, `${section} healed mode`).toBe(defaults[section].mode)
      expect(defaultSectionMode(section), `${section} defaultSectionMode`).toBe(
        defaults[section].mode,
      )
    }
  })

  it('hands every parse a FRESH default sections object (no shared mutable state)', () => {
    const a = characterSchema.parse(base)
    const b = characterSchema.parse(base)
    a.sections.FBM.enabled = true
    expect(b.sections.FBM.enabled).toBe(false)
  })
})

describe('sections schema — duplicate group/pose id healing', () => {
  const dupPose = (id: string, name: string) => ({
    id,
    name,
    morphs: [{ node: 'Genesis9', prop: `body_bs_${name}`, value: 1 }],
  })
  const group = (id: string, poses: Array<ReturnType<typeof dupPose>>) => ({
    id,
    suffix: 'centre',
    method: 'cumulative',
    poses,
  })

  it('re-mints the LATER duplicate ids (groups and poses), keeping the first', () => {
    const character = characterSchema.parse({
      ...base,
      sections: {
        EXP: { enabled: true, mode: 'custom', groups: [group('dup-g', [dupPose('dup-p', 'A')])] },
        FBM: { enabled: true, mode: 'custom', groups: [group('dup-g', [dupPose('dup-p', 'B')])] },
      },
    })
    const expGroup = character.sections.EXP.groups[0]
    const fbmGroup = character.sections.FBM.groups[0]
    // The first occurrence (canonical ROM order) keeps its stored id.
    expect(expGroup.id).toBe('dup-g')
    expect(expGroup.poses[0].id).toBe('dup-p')
    // The later one is re-minted — unique, non-empty.
    expect(fbmGroup.id).not.toBe('dup-g')
    expect(fbmGroup.id).not.toBe('')
    expect(fbmGroup.poses[0].id).not.toBe('dup-p')
    expect(fbmGroup.poses[0].id).not.toBe('')
  })

  it('leaves already-unique ids untouched', () => {
    const character = characterSchema.parse({
      ...base,
      sections: {
        EXP: { enabled: true, mode: 'custom', groups: [group('g1', [dupPose('p1', 'A')])] },
        FBM: { enabled: true, mode: 'custom', groups: [group('g2', [dupPose('p2', 'B')])] },
      },
    })
    expect(character.sections.EXP.groups[0].id).toBe('g1')
    expect(character.sections.FBM.groups[0].id).toBe('g2')
    expect(character.sections.EXP.groups[0].poses[0].id).toBe('p1')
    expect(character.sections.FBM.groups[0].poses[0].id).toBe('p2')
  })

  it('generation of a healed character keeps both groups separate (no merged frame ranges)', () => {
    // Before healing, two groups sharing an id merged into ONE groupRanges entry
    // in the generated FBM meta: one bogus start..end span covering both — a
    // non-individual method then shaped the timeline of BOTH groups as one.
    const character = characterSchema.parse({
      ...base,
      sections: {
        EXP: {
          enabled: true,
          mode: 'custom',
          groups: [group('dup-g', [dupPose('dup-p', 'A'), dupPose('p2', 'B')])],
        },
        FBM: { enabled: true, mode: 'custom', groups: [group('dup-g', [dupPose('p3', 'C')])] },
      },
    })
    const data = buildFbmData(character) as {
      groups?: Array<{ section: string; startFrame: number; endFrame: number }>
    }
    // Two cumulative groups → two group entries with disjoint, correct ranges
    // (EXP frames 0-1, FBM frame 2) — not one merged 0-2 span.
    expect(data.groups).toEqual([
      expect.objectContaining({ section: 'EXP', startFrame: 0, endFrame: 1 }),
      expect.objectContaining({ section: 'FBM', startFrame: 2, endFrame: 2 }),
    ])
  })
})

describe('numeric fields reject non-finite values (they would serialize as null in the .dsa)', () => {
  // JSON.stringify(Infinity) is `null` — a morph value/strength that reaches the
  // generated script as null is a guaranteed runtime morph failure in Daz. zod 4
  // z.number() already rejects Infinity/-Infinity/NaN; these cases PIN that
  // posture so a future schema/zod change can't quietly re-admit them.
  const withMorphValue = (value: number) => ({
    ...base,
    sections: {
      FBM: {
        enabled: true,
        mode: 'custom',
        groups: [
          { id: 'g', poses: [{ id: 'p', name: 'X', morphs: [{ node: 'Genesis9', prop: 'a', value }] }] },
        ],
      },
    },
  })

  for (const bad of [Infinity, -Infinity, NaN]) {
    it(`rejects ${bad} across morph values, strengths, keepValue and JCM ranges`, () => {
      expect(characterSchema.safeParse(withMorphValue(bad)).success).toBe(false)
      expect(characterSchema.safeParse({ ...base, facsDetailStrength: bad }).success).toBe(false)
      expect(characterSchema.safeParse({ ...base, flexionStrength: bad }).success).toBe(false)
      expect(
        characterSchema.safeParse({ ...base, preserveMorphs: [{ name: 'm', keepValue: bad }] })
          .success,
      ).toBe(false)
      expect(
        characterSchema.safeParse({
          ...base,
          jcmMorphMods: [
            {
              boneLabel: 'b',
              axis: 'XRotate',
              drives: [{ morphName: 'm', range: { angle: { start: 0, end: bad }, value: { start: 0, end: 1 } } }],
            },
          ],
        }).success,
      ).toBe(false)
    })
  }
})

describe('compareDthVersions', () => {
  it('orders by numeric segments, not lexically', () => {
    expect(compareDthVersions('2.4.10', '2.4.3')).toBeGreaterThan(0)
    expect(compareDthVersions('2.4.3', '2.5.0')).toBeLessThan(0)
    expect(compareDthVersions('2.4.3', '2.4.3')).toBe(0)
  })

  it('treats missing segments as 0 and empty as lowest', () => {
    expect(compareDthVersions('2.4', '2.4.0')).toBe(0)
    expect(compareDthVersions('', '2.4.3')).toBeLessThan(0)
  })
})

describe('exporterSupportsGroomHide', () => {
  it('accepts the min groom exporter version and above', () => {
    expect(exporterSupportsGroomHide(MIN_GROOM_EXPORTER_VERSION)).toBe(true) // 2.0.1
    expect(exporterSupportsGroomHide('2.0.2')).toBe(true)
    expect(exporterSupportsGroomHide('2.1.0')).toBe(true)
  })

  it('rejects older plugins that would leak hidden hair into the FBX', () => {
    expect(exporterSupportsGroomHide('2.0.0')).toBe(false)
    expect(exporterSupportsGroomHide('1.9.6')).toBe(false)
  })

  it("doesn't warn when the version is unknown (empty)", () => {
    // '' = plugin not installed / not readable — never nag on a missing read.
    expect(exporterSupportsGroomHide('')).toBe(true)
  })
})

describe('poseAssetCsvEra', () => {
  it('maps releases at/after a breaking version to that era', () => {
    expect(poseAssetCsvEra('2.0')).toBe('2.0')
    expect(poseAssetCsvEra('2.4.3')).toBe('2.0') // not a breaking release → same era
    expect(poseAssetCsvEra('2.9.0')).toBe('2.0') // until a newer breaking version is added
  })

  it('is empty for a release before the first baseline or when none is given', () => {
    expect(poseAssetCsvEra('1.9.6')).toBe('') // the pre-2.0 (CTL-rows) era — the old Houdini pipeline
    expect(poseAssetCsvEra('')).toBe('')
  })
})

describe('genesisFigureNode', () => {
  it('maps each generation to its unrenamed base-figure node name', () => {
    expect(genesisFigureNode('G9', 'female')).toBe('Genesis9')
    expect(genesisFigureNode('G9', 'male')).toBe('Genesis9')
    expect(genesisFigureNode('G8.1', 'female')).toBe('Genesis8_1Female')
    expect(genesisFigureNode('G8.1', 'male')).toBe('Genesis8_1Male')
    expect(genesisFigureNode('G8', 'female')).toBe('Genesis8Female')
    expect(genesisFigureNode('G3', 'male')).toBe('Genesis3Male')
  })
})

describe('characterSkinning genesis default', () => {
  it('defaults to linear for generations DTH ships no DQS ROM for', () => {
    const character = characterSchema.parse(base)
    expect(characterSkinning(character)).toBe('dqs')
    expect(characterSkinning({ ...character, genesis: 'G8.1' })).toBe('dqs')
    expect(characterSkinning({ ...character, genesis: 'G8' })).toBe('linear')
    expect(characterSkinning({ ...character, genesis: 'G3' })).toBe('linear')
    // An explicit DQS pick still wins over the generation default.
    const sections = structuredClone(character.sections)
    sections.JCM.presetAssets = ['G8 Custom DQS JCM - Base.duf']
    expect(characterSkinning({ ...character, genesis: 'G8', sections })).toBe('dqs')
  })

  it('matches DQS against the asset BASENAME only, never the folder path', () => {
    const character = characterSchema.parse(base)
    // A custom base living in a "DQS Library" folder must not force DQS when the
    // file itself is a Linear base (wrong skinning = wrong frame counts).
    const inDqsFolder = structuredClone(character.sections)
    inDqsFolder.JCM.mode = 'custom'
    inDqsFolder.JCM.customAssetPath = 'D:\\DQS Library\\My Linear Base.duf'
    expect(characterSkinning({ ...character, sections: inDqsFolder })).toBe('linear')
    // A DQS file name still reads as DQS wherever it lives.
    const dqsFile = structuredClone(character.sections)
    dqsFile.JCM.mode = 'custom'
    dqsFile.JCM.customAssetPath = 'D:/Linear Stuff/My DQS Base.duf'
    expect(characterSkinning({ ...character, sections: dqsFile })).toBe('dqs')
  })
})
