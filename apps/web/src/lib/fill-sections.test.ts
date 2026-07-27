import { describe, expect, it } from 'vitest'

import { defaultSections } from '@dth/rom'
import {
  fillSectionsFrom,
  filledSections,
  sectionContentSummary,
  sectionFilled,
} from './fill-sections.ts'

import type { RomGroup, RomPose, RomSectionConfig, RomSections } from '@dth/rom'

function config(over: Partial<RomSectionConfig> = {}): RomSectionConfig {
  return {
    enabled: false,
    mode: 'custom',
    presetAssets: [],
    artDirection: [],
    groups: [],
    customAssetPath: '',
    ...over,
  }
}

function pose(id: string): RomPose {
  return { id, name: `Pose_${id}`, morphs: [], boneScaleRef: false }
}

function group(id: string, poses: Array<RomPose>): RomGroup {
  return { id, label: '', suffix: 'centre', method: 'default', calculateFrom: 'default', poses }
}

describe('sectionFilled', () => {
  it('a disabled section is never filled', () => {
    expect(sectionFilled(config({ enabled: false, mode: 'preset' }))).toBe(false)
  })

  it('an enabled preset section is always filled — the preset selection is the config', () => {
    expect(sectionFilled(config({ enabled: true, mode: 'preset' }))).toBe(true)
  })

  it('an enabled custom section needs content: a pose or a custom base ROM', () => {
    expect(sectionFilled(config({ enabled: true }))).toBe(false)
    expect(sectionFilled(config({ enabled: true, groups: [group('g1', [])] }))).toBe(false)
    expect(sectionFilled(config({ enabled: true, groups: [group('g1', [pose('p1')])] }))).toBe(true)
    expect(sectionFilled(config({ enabled: true, customAssetPath: 'X:/roms/base.duf' }))).toBe(true)
  })
})

describe('filledSections', () => {
  it('lists the filled sections in canonical ROM order — RET derived from JCM', () => {
    const sections: RomSections = {
      ...defaultSections(),
      // Stored RET flag is IGNORED: RET counts as filled because JCM is an
      // enabled preset (the retargeting poses live inside the JCM base ROM).
      RET: config({ enabled: false }),
      JCM: config({ enabled: true, mode: 'preset' }),
      FAC: config({ enabled: false }),
      FBM: config({ enabled: true, groups: [group('g1', [pose('p1')])] }),
      MISC: config({ enabled: true }), // enabled but empty — not offered
    }
    expect(filledSections(sections)).toEqual(['RET', 'JCM', 'FBM'])
  })

  it('no enabled JCM preset, no RET — regardless of the stored RET flag', () => {
    const sections: RomSections = {
      ...defaultSections(),
      RET: config({ enabled: true, mode: 'preset' }),
      JCM: config({ enabled: true, customAssetPath: 'X:/roms/base.duf' }), // custom mode
      FAC: config({ enabled: false }),
    }
    expect(filledSections(sections)).toEqual(['JCM'])
  })
})

describe('sectionContentSummary', () => {
  it('summarizes preset sections (with the art-directed frame count when present)', () => {
    expect(sectionContentSummary(config({ mode: 'preset' }))).toBe('preset ROM')
    expect(
      sectionContentSummary(
        config({
          mode: 'preset',
          artDirection: [
            { id: 'a1', rom: 'gp', frame: 100, name: 'AnusOpen', morphs: [] },
            { id: 'a2', rom: 'gp', frame: 101, name: 'AnusContraction', morphs: [] },
          ],
        }),
      ),
    ).toBe('preset ROM · 2 art-directed frames')
  })

  it('summarizes custom sections from their non-empty groups and poses', () => {
    expect(sectionContentSummary(config({ groups: [group('g1', [pose('p1')])] }))).toBe('1 pose')
    expect(
      sectionContentSummary(
        config({
          groups: [group('g1', [pose('p1'), pose('p2')]), group('g2', [pose('p3')]), group('g3', [])],
        }),
      ),
    ).toBe('2 groups · 3 poses')
    expect(
      sectionContentSummary(
        config({ customAssetPath: 'X:/roms/base.duf', groups: [group('g1', [pose('p1')])] }),
      ),
    ).toBe('custom base ROM · 1 pose')
  })
})

describe('fillSectionsFrom', () => {
  it('replaces the picked sections and leaves the rest untouched', () => {
    const target = defaultSections()
    const source: RomSections = {
      ...defaultSections(),
      EXP: config({ enabled: true, groups: [group('g1', [pose('p1')])] }),
      FBM: config({ enabled: true, groups: [group('g2', [pose('p2')])] }),
    }
    const next = fillSectionsFrom(target, source, ['EXP'])
    expect(next.EXP).toEqual(source.EXP)
    expect(next.FBM).toBe(target.FBM) // unpicked — the exact same object
    expect(next.JCM).toBe(target.JCM)
  })

  it('deep-copies: mutating the result never reaches the source character', () => {
    const source: RomSections = {
      ...defaultSections(),
      EXP: config({ enabled: true, groups: [group('g1', [pose('p1')])] }),
    }
    const next = fillSectionsFrom(defaultSections(), source, ['EXP'])
    next.EXP.groups[0].poses[0].name = 'Mutated'
    expect(source.EXP.groups[0].poses[0].name).toBe('Pose_p1')
  })

  it("GEN keeps the target's scene-derived enabled state and GP/DK selection", () => {
    const target: RomSections = {
      ...defaultSections(),
      GEN: config({ enabled: true, mode: 'preset', presetAssets: ['GP9 - Golden Palace.duf'] }),
    }
    const source: RomSections = {
      ...defaultSections(),
      GEN: config({
        enabled: true,
        mode: 'preset',
        presetAssets: ['GP9 - Golden Palace.duf', 'DK9 - Dicktator.duf'],
        artDirection: [{ id: 'a1', rom: 'gp', frame: 100, name: 'AnusOpen', morphs: [] }],
      }),
    }
    const next = fillSectionsFrom(target, source, ['GEN'])
    expect(next.GEN.enabled).toBe(true)
    expect(next.GEN.presetAssets).toEqual(['GP9 - Golden Palace.duf'])
    expect(next.GEN.artDirection).toEqual(source.GEN.artDirection)

    // And a target whose scene has no geograft stays GEN-disabled.
    const bare = fillSectionsFrom(defaultSections(), source, ['GEN'])
    expect(bare.GEN.enabled).toBe(false)
    expect(bare.GEN.presetAssets).toEqual([])
  })
})
