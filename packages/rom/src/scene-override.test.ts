import { describe, expect, it } from 'vitest'

import { generateAll } from './generate'
import {
  activeSceneOverrides,
  applySceneOverride,
  clonePose,
  mergeSceneOverride,
  sceneOverrideBuildsRom,
  sceneOverrideSlug,
} from './scene-override'
import { characterSchema, defaultSections, flatSectionGroupId, sceneOverrideSchema } from './types'

import type { PresetFrames } from './frames'
import type { Character, RomGroup, RomSections, SceneOverride } from './types'

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
        name: 'GluteSize',
        morphs: [{ id: 'm2', node: 'Genesis9', prop: 'body_bs_GluteSize', value: -1 }],
        boneScaleRef: false,
      },
    ],
  }
}

function makeSections(): RomSections {
  const sections = defaultSections()
  sections.FBM.enabled = true
  sections.FBM.groups = [fbmGroup()]
  return sections
}

function makeCharacter(overrides: Partial<Character> = {}): Character {
  const now = '2026-07-20T00:00:00.000Z'
  return characterSchema.parse({
    id: 'test',
    name: 'Electra G9',
    createdAt: now,
    updatedAt: now,
    sections: makeSections(),
    ...overrides,
  })
}

// Defaults the ROM gate ON (the schema now defaults it off) — most cases here
// want a ROM-active override; pass `enabled: false` for the identity/groom-only
// cases.
function makeOverride(patch: Partial<SceneOverride> = {}): SceneOverride {
  return sceneOverrideSchema.parse({ scenePath: 'D:\\scenes\\Electra Beach.duf', enabled: true, ...patch })
}

describe('applySceneOverride', () => {
  it('replaces a base row IN PLACE by pose id — same frame, other content', () => {
    const override = makeOverride({
      poses: [
        {
          id: 'p1',
          name: 'BeachBodyTone',
          morphs: [{ id: 'mo1', node: 'Genesis9', prop: 'body_bs_BeachTone', value: 0.5 }],
          boneScaleRef: false,
        },
      ],
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['BeachBodyTone', 'GluteSize'])
    expect(merged.FBM.groups[0].poses[0].morphs[0].prop).toBe('body_bs_BeachTone')
  })

  it('ignores a replacement whose base pose no longer exists', () => {
    const override = makeOverride({
      poses: [{ id: 'gone', name: 'Orphan', morphs: [], boneScaleRef: false }],
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['BodyTone', 'GluteSize'])
  })

  it('appends added rows at the END of their group, never in between', () => {
    const override = makeOverride({
      additions: [
        {
          groupId: 'g1',
          poses: [
            {
              id: 'a1',
              name: 'BeachDress',
              morphs: [{ id: 'ma1', node: 'BeachDress', prop: 'dress_bs_Flow', value: 1 }],
              boneScaleRef: false,
            },
          ],
        },
      ],
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual([
      'BodyTone',
      'GluteSize',
      'BeachDress',
    ])
  })

  it('ignores additions for a group that no longer exists', () => {
    const override = makeOverride({
      additions: [{ groupId: 'gone', poses: [{ id: 'a1', name: 'X', morphs: [], boneScaleRef: false }] }],
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.groups[0].poses).toHaveLength(2)
    expect(merged.MISC.groups).toEqual([])
  })

  it('materializes the implicit flat group for additions to an empty flat section', () => {
    const override = makeOverride({
      additions: [
        {
          groupId: flatSectionGroupId('MISC'),
          poses: [{ id: 'a1', name: 'OutfitFix', morphs: [], boneScaleRef: false }],
        },
      ],
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.MISC.groups).toHaveLength(1)
    expect(merged.MISC.groups[0].id).toBe(flatSectionGroupId('MISC'))
    expect(merged.MISC.groups[0].poses.map((p) => p.name)).toEqual(['OutfitFix'])
  })

  it('never mutates the base sections', () => {
    const sections = makeSections()
    const before = structuredClone(sections)
    applySceneOverride(
      sections,
      makeOverride({
        poses: [{ id: 'p1', name: 'Changed', morphs: [], boneScaleRef: false }],
        additions: [{ groupId: 'g1', poses: [{ id: 'a1', name: 'Added', morphs: [], boneScaleRef: false }] }],
      }),
    )
    expect(sections).toEqual(before)
  })
})

describe('sceneOverrideSlug', () => {
  it('reduces the scene file stem to generated-file-name characters', () => {
    expect(sceneOverrideSlug('D:\\scenes\\Electra Beach.duf')).toBe('ElectraBeach')
    expect(sceneOverrideSlug('/mnt/scenes/office-look_v2.duf')).toBe('officelook_v2')
  })

  it('falls back to "Scene" when nothing survives', () => {
    expect(sceneOverrideSlug('D:\\scenes\\日本語.duf')).toBe('Scene')
    expect(sceneOverrideSlug('')).toBe('Scene')
  })
})

describe('activeSceneOverrides', () => {
  it('keeps only enabled overrides whose scene is a linked EXTRA scene', () => {
    const linked = makeOverride({ scenePath: 'D:\\s\\Beach.duf' })
    const disabled = makeOverride({ scenePath: 'D:\\s\\Office.duf', enabled: false })
    const unlinked = makeOverride({ scenePath: 'D:\\s\\Gone.duf' })
    const character = makeCharacter({
      scenePath: 'D:\\s\\Primary.duf',
      extraScenes: ['D:\\s\\Beach.duf', 'D:\\s\\Office.duf'],
      sceneOverrides: [linked, disabled, unlinked],
    })
    expect(activeSceneOverrides(character)).toEqual([linked])
  })
})

describe('clonePose', () => {
  it('copies deep enough that editing the clone leaves the base untouched', () => {
    const base = fbmGroup().poses[0]
    const clone = clonePose(base)
    clone.morphs[0].value = 99
    expect(base.morphs[0].value).toBe(1)
  })
})

describe('generateAll — scene overrides folded into the one script', () => {
  const scene = 'D:\\scenes\\Electra Beach.duf'
  // The open-scene key the generated lookup computes from Scene.getFilename():
  // forward-slashed and lowercased.
  const sceneKey = 'd:/scenes/electra beach.duf'
  const override = makeOverride({
    scenePath: scene,
    poses: [
      {
        id: 'p1',
        name: 'BeachBodyTone',
        morphs: [{ id: 'mo2', node: 'Genesis9', prop: 'body_bs_BeachTone', value: 0.5 }],
        boneScaleRef: false,
      },
    ],
    additions: [
      {
        groupId: 'g1',
        poses: [
          {
            id: 'a1',
            name: 'BeachDress',
            morphs: [{ id: 'ma2', node: 'BeachDress', prop: 'dress_bs_Flow', value: 1 }],
            boneScaleRef: false,
          },
        ],
      },
    ],
  })
  // A scene override only generates once its scene is a LINKED extra scene.
  const withScene = (extra: Partial<Character> = {}): Character =>
    makeCharacter({ extraScenes: [scene], sceneOverrides: [override], ...extra })

  // Pull a `var <name> = { … };` object literal back out of a generated script.
  const grabObject = (script: string, name: string) => {
    const marker = `var ${name} = `
    const open = script.indexOf(marker) + marker.length
    return JSON.parse(script.slice(open, script.indexOf('\n};', open) + 2))
  }

  it('emits ONE ROM script + base CSV + the scene-suffixed CSV (no per-scene script)', () => {
    const files = generateAll(withScene(), {}, FRAMES)
    expect(files.map((f) => f.fileName)).toEqual([
      'ROM_ElectraG9_G9.dsa',
      'ElectraG9_pose_asset.csv',
      'ElectraG9_ElectraBeach_pose_asset.csv',
    ])
  })

  it('embeds the MERGED rows as the open scene’s config delta; base rows untouched', () => {
    const files = generateAll(withScene(), {}, FRAMES)
    const script = files[0].content
    // The base config carries the primary scene's frames …
    expect(grabObject(script, 'dthCharacterConfig').extraFrames.frames.map((f: { name: string }) => f.name)).toEqual([
      'BodyTone',
      'GluteSize',
    ])
    // … the scene delta carries the merged rows (replaced content + addition).
    const overrides = grabObject(script, 'dthSceneOverrides')
    expect(overrides[sceneKey].extraFrames.frames.map((f: { name: string }) => f.name)).toEqual([
      'BeachBodyTone',
      'GluteSize',
      'BeachDress',
    ])
    // The scene's own CSV reflects the merged rows, not the base ones.
    const csv = files[2].content
    expect(csv).toContain('BeachBodyTone')
    expect(csv).toContain('BeachDress')
    expect(csv).not.toContain('FBM,328,BodyTone')
  })

  it('splits ONE Export_ script (not per-scene) when the character splits its export', () => {
    const files = generateAll(withScene({ exportPath: 'D:\\export', exportWithRomScript: false }), {}, FRAMES)
    expect(files.map((f) => f.fileName)).toEqual([
      'ROM_ElectraG9_G9.dsa',
      'Export_ElectraG9_G9.dsa',
      'ElectraG9_pose_asset.csv',
      'ElectraG9_ElectraBeach_pose_asset.csv',
    ])
  })

  it('the combined script selects the scene CSV by open scene', () => {
    const script = generateAll(withScene({ exportPath: 'D:\\export' }), {}, FRAMES, 'C:\\project\\Electra')[0]
      .content
    // The export block's scene→CSV lookup carries the override CSV, keyed by scene,
    // while the base name stays the default every other scene rides.
    expect(script).toContain('dthCsvByScene')
    expect(script).toContain('"ElectraG9_ElectraBeach_pose_asset.csv"')
    expect(script).toContain('"ElectraG9_pose_asset.csv"')
    expect(script).toContain(sceneKey)
  })

  it('an identity-only override adds a config delta but NO scene CSV', () => {
    const idOverride = makeOverride({
      scenePath: scene,
      enabled: false,
      identity: { enabled: true, facsDetailStrength: 0.5, flexionStrength: 0.5, applyUE5TearUV: true },
    })
    const files = generateAll(
      makeCharacter({ extraScenes: [scene], sceneOverrides: [idOverride] }),
      {},
      FRAMES,
    )
    // Base ROM script + base CSV only — no scene-suffixed CSV (frames unchanged).
    expect(files.map((f) => f.fileName)).toEqual(['ROM_ElectraG9_G9.dsa', 'ElectraG9_pose_asset.csv'])
    const delta = grabObject(files[0].content, 'dthSceneOverrides')[sceneKey]
    expect(delta).toMatchObject({ FACsDetailStrength: 0.5, FlexionStrength: 0.5, bApplyUE5TearUV: true })
    expect(delta.extraFrames).toBeUndefined()
    // sceneOverrideBuildsRom is what gates the extra CSV.
    expect(sceneOverrideBuildsRom(idOverride)).toBe(false)
  })

  it('mergeSceneOverride swaps the G9 dials for an identity override', () => {
    const idOverride = makeOverride({
      scenePath: scene,
      identity: { enabled: true, facsDetailStrength: 0.25, flexionStrength: 0.75, applyUE5TearUV: true },
    })
    const merged = mergeSceneOverride(makeCharacter(), idOverride)
    expect(merged.facsDetailStrength).toBe(0.25)
    expect(merged.flexionStrength).toBe(0.75)
    expect(merged.applyUE5TearUV).toBe(true)
  })
})
