import { describe, expect, it } from 'vitest'

import {
  CHARACTER_SCHEMA_VERSION,
  MIN_GROOM_EXPORTER_VERSION,
  artDirectionFrameSchema,
  characterSchema,
  characterSkinning,
  compareDthVersions,
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

  it('hands every parse a FRESH default sections object (no shared mutable state)', () => {
    const a = characterSchema.parse(base)
    const b = characterSchema.parse(base)
    a.sections.FBM.enabled = true
    expect(b.sections.FBM.enabled).toBe(false)
  })
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
})
