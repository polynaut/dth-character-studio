import { describe, expect, it } from 'vitest'

import { generateAll } from './generate'
import {
  activeSceneOverrides,
  applySceneOverride,
  clonePose,
  mergeSceneOverride,
  romPoseEqual,
  sceneOverrideBuildsRom,
  sceneOverrideSlug,
} from './scene-override'
import { characterSchema, defaultSections, flatSectionGroupId, sceneOverrideSchema } from './types'

import type { z } from 'zod'
import type { PresetFrames } from './frames'
import type { ArtDirectionFrame, Character, RomGroup, RomSections, SceneOverride } from './types'

const FRAMES: PresetFrames = { base: 328, gp: 104, dk: 54, phys: 43 }

/** A whole-section OWNED config (what escalation / the v24 migration stores at
 *  `rom.<S>.owned`) — a custom, enabled section wrapping `groups`, the rest
 *  defaulted by the schema. */
function ownedConfig(groups: Array<RomGroup>) {
  return {
    enabled: true,
    mode: 'custom' as const,
    presetAssets: [],
    artDirection: [],
    groups,
    customAssetPath: '',
  }
}

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

// A record is armed by PRESENCE (schema v24): any `rom` entry or panel block in
// the patch arms it; an empty patch is the fully-disarmed state. The schema
// fills the `replaced`/`added`/`hair` defaults, so patches stay sparse.
function makeOverride(patch: Partial<z.input<typeof sceneOverrideSchema>> = {}): SceneOverride {
  return sceneOverrideSchema.parse({ scenePath: 'D:\\scenes\\Electra Beach.duf', ...patch })
}

describe('applySceneOverride', () => {
  it('replaces a base row IN PLACE by pose id — same frame, other content', () => {
    const override = makeOverride({
      rom: {
        FBM: {
          replaced: [
            {
              id: 'p1',
              name: 'BeachBodyTone',
              morphs: [{ id: 'mo1', node: 'Genesis9', prop: 'body_bs_BeachTone', value: 0.5 }],
              boneScaleRef: false,
            },
          ],
        },
      },
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['BeachBodyTone', 'GluteSize'])
    expect(merged.FBM.groups[0].poses[0].morphs[0].prop).toBe('body_bs_BeachTone')
  })

  it('ignores a replacement whose base pose no longer exists', () => {
    const override = makeOverride({
      rom: { FBM: { replaced: [{ id: 'gone', name: 'Orphan', morphs: [], boneScaleRef: false }] } },
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['BodyTone', 'GluteSize'])
  })

  it('appends added rows at the END of their group, never in between', () => {
    const override = makeOverride({
      rom: {
        FBM: {
          added: [
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
        },
      },
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
      rom: {
        FBM: {
          added: [{ groupId: 'gone', poses: [{ id: 'a1', name: 'X', morphs: [], boneScaleRef: false }] }],
        },
      },
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.groups[0].poses).toHaveLength(2)
    expect(merged.MISC.groups).toEqual([])
  })

  it('materializes the implicit flat group for additions to an empty flat section', () => {
    const override = makeOverride({
      rom: {
        MISC: {
          added: [
            {
              groupId: flatSectionGroupId('MISC'),
              poses: [{ id: 'a1', name: 'OutfitFix', morphs: [], boneScaleRef: false }],
            },
          ],
        },
      },
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.MISC.groups).toHaveLength(1)
    expect(merged.MISC.groups[0].id).toBe(flatSectionGroupId('MISC'))
    expect(merged.MISC.groups[0].poses.map((p) => p.name)).toEqual(['OutfitFix'])
  })

  it('disables an enabled section for the scene (mode/groups untouched, off for frames)', () => {
    const override = makeOverride({ rom: { FBM: { enabled: false } } })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.enabled).toBe(false)
    // The base groups stay put — re-enabling brings them back unchanged.
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['BodyTone', 'GluteSize'])
  })

  it('enables a section the base leaves disabled (uses the base config)', () => {
    const base = makeSections()
    expect(base.MISC.enabled).toBe(false)
    const override = makeOverride({ rom: { MISC: { enabled: true } } })
    const merged = applySceneOverride(base, override)
    expect(merged.MISC.enabled).toBe(true)
  })

  it('an enable override applies alongside an owned config at the same key', () => {
    const override = makeOverride({
      rom: {
        FBM: {
          enabled: false,
          owned: ownedConfig([
            { ...fbmGroup(), poses: [{ id: 'only', name: 'OnlyThis', morphs: [], boneScaleRef: false }] },
          ]),
        },
      },
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.enabled).toBe(false)
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['OnlyThis'])
  })

  it('leaves a section untouched when it has no override entry', () => {
    const override = makeOverride({ rom: { FBM: { enabled: false } } })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.JCM.enabled).toBe(makeSections().JCM.enabled)
  })

  it('an owned config replaces the section verbatim — reordered / restructured', () => {
    // The scene reorders FBM (GluteSize before BodyTone) — a structural change the
    // sparse layer can't express, so it's stored whole in `rom.FBM.owned`.
    const override = makeOverride({
      rom: {
        FBM: {
          owned: ownedConfig([
            { ...fbmGroup(), poses: [fbmGroup().poses[1], fbmGroup().poses[0]] }, // GluteSize, BodyTone
          ]),
        },
      },
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['GluteSize', 'BodyTone'])
  })

  it('an owned config WINS over sparse replaced/added lingering at the same key', () => {
    // Escalation clears the sparse layers when it stores `owned`, but the schema
    // still tolerates both — precedence must be structural, not data-dependent.
    const override = makeOverride({
      rom: {
        FBM: {
          replaced: [{ id: 'p1', name: 'ShouldBeIgnored', morphs: [], boneScaleRef: false }],
          added: [
            { groupId: 'g1', poses: [{ id: 'x', name: 'AlsoIgnored', morphs: [], boneScaleRef: false }] },
          ],
          owned: ownedConfig([
            { ...fbmGroup(), poses: [{ id: 'only', name: 'OnlyThis', morphs: [], boneScaleRef: false }] },
          ]),
        },
      },
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['OnlyThis'])
  })

  it('leaves sections WITHOUT an owned config on the sparse layer', () => {
    const override = makeOverride({
      rom: {
        FBM: { replaced: [{ id: 'p1', name: 'SparseReplace', morphs: [], boneScaleRef: false }] },
        MISC: { owned: ownedConfig([]) }, // only MISC is whole-overridden
      },
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['SparseReplace', 'GluteSize'])
    expect(merged.MISC.groups).toEqual([])
  })

  it('never mutates the base sections', () => {
    const sections = makeSections()
    const before = structuredClone(sections)
    applySceneOverride(
      sections,
      makeOverride({
        rom: {
          FBM: {
            replaced: [{ id: 'p1', name: 'Changed', morphs: [], boneScaleRef: false }],
            added: [{ groupId: 'g1', poses: [{ id: 'a1', name: 'Added', morphs: [], boneScaleRef: false }] }],
          },
        },
      }),
    )
    expect(sections).toEqual(before)
  })
})

describe('applySceneOverride — full owned config (mode / preset / art direction)', () => {
  const ownedGen = (patch: Record<string, unknown>) => ({
    enabled: true,
    mode: 'preset' as const,
    presetAssets: [],
    artDirection: [],
    groups: [],
    customAssetPath: '',
    ...patch,
  })

  it('replaces the whole section config (a per-scene preset-asset swap)', () => {
    const merged = applySceneOverride(
      makeSections(),
      makeOverride({ rom: { GEN: { owned: ownedGen({ presetAssets: ['DK9 - Dicktator.duf'] }) } } }),
    )
    expect(merged.GEN.mode).toBe('preset')
    expect(merged.GEN.presetAssets).toEqual(['DK9 - Dicktator.duf'])
  })

  it('carries the scene’s own art direction (frame content)', () => {
    const art = [
      { id: 'ad1', rom: 'gp' as const, frame: 96, name: 'VaginaOpen', morphs: [{ id: 'm', node: 'GoldenPalace_G9', prop: 'GP_Vagina_Open', value: 0.8 }] },
    ]
    const merged = applySceneOverride(
      makeSections(),
      makeOverride({ rom: { GEN: { owned: ownedGen({ artDirection: art }) } } }),
    )
    expect(merged.GEN.artDirection).toEqual(art)
  })

  it('`enabled` still overlays on top of an owned config', () => {
    const merged = applySceneOverride(
      makeSections(),
      makeOverride({
        rom: { GEN: { owned: ownedGen({ presetAssets: ['DK9 - Dicktator.duf'] }), enabled: false } },
      }),
    )
    expect(merged.GEN.enabled).toBe(false)
    expect(merged.GEN.presetAssets).toEqual(['DK9 - Dicktator.duf']) // rest of the owned config applies
  })
})

describe('mergeSceneOverride — jcm swap', () => {
  const mods = [{ id: 'r1', boneLabel: 'Left Thigh', axis: 'XRotate', drives: [] }]
  const withBaseJcm = () =>
    makeCharacter({ jcmMorphMods: [{ id: 'base', boneLabel: 'Right Thigh', axis: 'XRotate', drives: [] }] })

  it('swaps jcmMorphMods when the jcm panel is armed (block present)', () => {
    const merged = mergeSceneOverride(withBaseJcm(), makeOverride({ jcm: mods }))
    expect(merged.jcmMorphMods).toEqual(mods)
  })

  it('leaves jcmMorphMods alone when the jcm block is absent (disarmed)', () => {
    const character = withBaseJcm()
    const merged = mergeSceneOverride(character, makeOverride({}))
    expect(merged.jcmMorphMods).toEqual(character.jcmMorphMods)
  })
})

describe('sceneOverrideBuildsRom — structural (frame-layout) gate', () => {
  const artA: ArtDirectionFrame = { id: 'a', rom: 'gp', frame: 96, name: 'X', morphs: [] }
  const artB: ArtDirectionFrame = { id: 'a', rom: 'gp', frame: 96, name: 'X', morphs: [{ id: 'm', node: 'GoldenPalace_G9', prop: 'GP_Open', value: 0.8 }] }
  const genConfig = (artDirection: Array<ArtDirectionFrame>, presetAssets = ['GP9 - Golden Palace.duf']) => ({
    enabled: true, mode: 'preset' as const, presetAssets, artDirection, groups: [], customAssetPath: '',
  })
  const genBase = () => makeCharacter({ sections: { ...defaultSections(), GEN: genConfig([artA]) } })

  it('a custom-row change builds a per-scene CSV', () => {
    const override = makeOverride({
      rom: { FBM: { replaced: [{ id: 'p1', name: 'BeachTone', morphs: [], boneScaleRef: false }] } },
    })
    expect(sceneOverrideBuildsRom(makeCharacter(), override)).toBe(true)
  })

  it('an art-direction-only owned config does NOT build a CSV (rides the base CSV)', () => {
    const override = makeOverride({ rom: { GEN: { owned: genConfig([artB]) } } })
    expect(sceneOverrideBuildsRom(genBase(), override)).toBe(false)
  })

  it('a preset-asset swap DOES build a CSV (changes the frame layout)', () => {
    const override = makeOverride({
      rom: { GEN: { owned: genConfig([artA], ['DK9 - Dicktator.duf']) } },
    })
    expect(sceneOverrideBuildsRom(genBase(), override)).toBe(true)
  })

  it('a jcm-only override does NOT build a CSV', () => {
    const override = makeOverride({
      jcm: [{ id: 'r1', boneLabel: 'Left Thigh', axis: 'XRotate', drives: [] }],
    })
    expect(sceneOverrideBuildsRom(makeCharacter(), override)).toBe(false)
  })

  it('a fully-disarmed record (empty rom, no panels) never builds', () => {
    // The v24 equivalent of the old "disabled override with stored rows": a
    // record whose rom is empty simply has nothing to compile.
    expect(sceneOverrideBuildsRom(makeCharacter(), makeOverride())).toBe(false)
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
  it('keeps only ARMED records whose scene is a linked EXTRA scene', () => {
    const linked = makeOverride({ scenePath: 'D:\\s\\Beach.duf', rom: { FBM: { enabled: false } } })
    // rom: {} + no panel blocks — the v24 "fully disarmed" state (the old
    // enabled:false gate no longer exists).
    const disarmed = makeOverride({ scenePath: 'D:\\s\\Office.duf' })
    const unlinked = makeOverride({ scenePath: 'D:\\s\\Gone.duf', rom: { FBM: { enabled: false } } })
    const character = makeCharacter({
      scenePath: 'D:\\s\\Primary.duf',
      extraScenes: ['D:\\s\\Beach.duf', 'D:\\s\\Office.duf'],
      sceneOverrides: [linked, disarmed, unlinked],
    })
    expect(activeSceneOverrides(character)).toEqual([linked])
  })

  it('a hair-only record does NOT activate an override (hair rides the groom map by presence)', () => {
    // Hair never arms: it generates from the per-scene groom map, not the
    // override delta — so a record carrying ONLY hair items must stay inert
    // (the primary scene's record is exactly this shape).
    const hairOnly = makeOverride({
      scenePath: 'D:\\s\\Beach.duf',
      hair: [{ nodeLabel: 'dForce Black Tie Cap' }],
    })
    const character = makeCharacter({
      scenePath: 'D:\\s\\Primary.duf',
      extraScenes: ['D:\\s\\Beach.duf'],
      sceneOverrides: [hairOnly],
    })
    expect(activeSceneOverrides(character)).toEqual([])
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

describe('romPoseEqual', () => {
  it('ignores ids but compares name, boneScaleRef and morph content', () => {
    const base = fbmGroup().poses[0]
    // A clone with different row/morph ids is still equal (ids are editing handles).
    expect(romPoseEqual({ ...clonePose(base), id: 'other', morphs: [{ ...base.morphs[0], id: 'x' }] }, base)).toBe(true)
    // A toggled bone-scale flag / changed value / name makes it unequal.
    expect(romPoseEqual({ ...clonePose(base), boneScaleRef: true }, base)).toBe(false)
    expect(romPoseEqual({ ...base, morphs: [{ ...base.morphs[0], value: 0.5 }] }, base)).toBe(false)
    expect(romPoseEqual({ ...base, name: 'Other' }, base)).toBe(false)
    // Different morph count is unequal.
    expect(romPoseEqual({ ...base, morphs: [...base.morphs, base.morphs[0]] }, base)).toBe(false)
  })
})

describe('generateAll — scene overrides folded into the one script', () => {
  const scene = 'D:\\scenes\\Electra Beach.duf'
  // The open-scene key the generated lookup computes from Scene.getFilename():
  // forward-slashed and lowercased.
  const sceneKey = 'd:/scenes/electra beach.duf'
  const override = makeOverride({
    scenePath: scene,
    rom: {
      FBM: {
        replaced: [
          {
            id: 'p1',
            name: 'BeachBodyTone',
            morphs: [{ id: 'mo2', node: 'Genesis9', prop: 'body_bs_BeachTone', value: 0.5 }],
            boneScaleRef: false,
          },
        ],
        added: [
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
      },
    },
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
      '.Build_ROM_Animation.dsa',
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
    const csv = files.find((f) => f.fileName === 'ElectraG9_ElectraBeach_pose_asset.csv')!.content
    expect(csv).toContain('BeachBodyTone')
    expect(csv).toContain('BeachDress')
    expect(csv).not.toContain('FBM,328,BodyTone')
  })

  it('a whole-section REORDER folds into the scene delta — Daz frames + CSV both reordered', () => {
    // The scene reorders FBM (GluteSize before BodyTone), stored as the owned
    // config. Both the Daz frame delta and the scene's CSV must follow the new
    // order (per-scene alignment).
    const reordered = makeOverride({
      scenePath: scene,
      rom: {
        FBM: { owned: ownedConfig([{ ...fbmGroup(), poses: [fbmGroup().poses[1], fbmGroup().poses[0]] }]) },
      },
    })
    const files = generateAll(withScene({ sceneOverrides: [reordered] }), {}, FRAMES)
    const overrides = grabObject(files[0].content, 'dthSceneOverrides')
    expect(overrides[sceneKey].extraFrames.frames.map((f: { name: string }) => f.name)).toEqual([
      'GluteSize',
      'BodyTone',
    ])
    const csv = files.find((f) => f.fileName === 'ElectraG9_ElectraBeach_pose_asset.csv')!.content
    expect(csv.indexOf('GluteSize')).toBeLessThan(csv.indexOf('BodyTone'))
  })

  it('splits ONE Export_ script (not per-scene) when the character splits its export', () => {
    const files = generateAll(withScene({ exportPath: 'D:\\export', exportWithRomScript: false }), {}, FRAMES)
    expect(files.map((f) => f.fileName)).toEqual([
      'ROM_ElectraG9_G9.dsa',
      'Export_ElectraG9_G9.dsa',
      '.Bulk_ROM_Export.dsa',
      '.Build_ROM_Animation.dsa',
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

  it('MULTIPLE overrides fold into the ONE script: each scene selectable + its own CSV', () => {
    const beach = 'D:\\scenes\\Electra Beach.duf'
    const office = 'D:\\scenes\\Electra Office.duf'
    const beachKey = 'd:/scenes/electra beach.duf'
    const officeKey = 'd:/scenes/electra office.duf'
    const romOverride = (path: string, poseName: string) =>
      makeOverride({
        scenePath: path,
        rom: {
          FBM: {
            replaced: [
              {
                id: 'p1',
                name: poseName,
                morphs: [{ id: 'm', node: 'Genesis9', prop: 'p', value: 1 }],
                boneScaleRef: false,
              },
            ],
          },
        },
      })
    const files = generateAll(
      makeCharacter({
        extraScenes: [beach, office],
        sceneOverrides: [romOverride(beach, 'BeachTone'), romOverride(office, 'OfficeTone')],
      }),
      {},
      FRAMES,
    )
    // ONE ROM script (no per-scene scripts) + base CSV + one CSV PER Daz scene
    // that overrides the ROM (Houdini has no runtime to pick frames).
    expect(files.map((f) => f.fileName)).toEqual([
      'ROM_ElectraG9_G9.dsa',
      '.Build_ROM_Animation.dsa',
      'ElectraG9_pose_asset.csv',
      'ElectraG9_ElectraBeach_pose_asset.csv',
      'ElectraG9_ElectraOffice_pose_asset.csv',
    ])
    // The one script embeds BOTH scenes' deltas, keyed by the open scene's path,
    // and selects the right one at run time from Scene.getFilename().
    const script = files[0].content
    const overrides = grabObject(script, 'dthSceneOverrides')
    expect(overrides[beachKey].extraFrames.frames.map((f: { name: string }) => f.name)).toContain(
      'BeachTone',
    )
    expect(overrides[officeKey].extraFrames.frames.map((f: { name: string }) => f.name)).toContain(
      'OfficeTone',
    )
    expect(script).toContain('Scene.getFilename()')
    expect(script).toContain('dthCharacterConfig[dthOk] = dthSceneDelta[dthOk]')
  })

  it('an identity-only override adds a config delta but NO scene CSV', () => {
    const idOverride = makeOverride({
      scenePath: scene,
      identity: { facsDetailStrength: 0.5, flexionStrength: 0.5, applyUE5TearUV: true },
    })
    const files = generateAll(
      makeCharacter({ extraScenes: [scene], sceneOverrides: [idOverride] }),
      {},
      FRAMES,
    )
    // Base ROM script + base CSV only — no scene-suffixed CSV (frames unchanged).
    expect(files.map((f) => f.fileName)).toEqual([
      'ROM_ElectraG9_G9.dsa',
      '.Build_ROM_Animation.dsa',
      'ElectraG9_pose_asset.csv',
    ])
    const delta = grabObject(files[0].content, 'dthSceneOverrides')[sceneKey]
    expect(delta).toMatchObject({ FACsDetailStrength: 0.5, FlexionStrength: 0.5, bApplyUE5TearUV: true })
    expect(delta.extraFrames).toBeUndefined()
    // sceneOverrideBuildsRom is what gates the extra CSV.
    expect(sceneOverrideBuildsRom(makeCharacter(), idOverride)).toBe(false)
  })

  it('mergeSceneOverride merges the ROM sections only (frames), not identity dials', () => {
    const romOverride = makeOverride({
      scenePath: scene,
      rom: {
        FBM: {
          replaced: [
            {
              id: 'p1',
              name: 'BeachTone',
              morphs: [{ id: 'mo', node: 'Genesis9', prop: 'b', value: 0.5 }],
              boneScaleRef: false,
            },
          ],
        },
      },
      identity: { facsDetailStrength: 0.25, flexionStrength: 0.75, applyUE5TearUV: true },
    })
    const merged = mergeSceneOverride(makeCharacter(), romOverride)
    // Sections reflect the ROM override…
    expect(merged.sections.FBM.groups[0].poses[0].name).toBe('BeachTone')
    // …but the identity dials stay the base's (they ride as a config delta instead).
    expect(merged.facsDetailStrength).toBe(1)
    expect(merged.flexionStrength).toBe(1)
    expect(merged.applyUE5TearUV).toBe(false)
  })

  it('a preserve-only override full-replaces the base lists (empty overrides too), NO scene CSV', () => {
    const preserveOverride = makeOverride({
      scenePath: scene,
      preserve: {
        morphs: [{ name: 'body_ctrl_BreastsUp-Down', keepValue: 0.6 }],
        nodeTransforms: [],
      },
    })
    const files = generateAll(
      makeCharacter({
        extraScenes: [scene],
        sceneOverrides: [preserveOverride],
        preserveMorphs: [{ name: 'base_morph', keepValue: 1 }],
        preserveNodeTransforms: [{ nodeLabel: 'Left Eye' }],
      }),
      {},
      FRAMES,
    )
    // Frames unchanged → no scene-suffixed CSV.
    expect(files.map((f) => f.fileName)).toEqual([
      'ROM_ElectraG9_G9.dsa',
      '.Build_ROM_Animation.dsa',
      'ElectraG9_pose_asset.csv',
    ])
    const delta = grabObject(files[0].content, 'dthSceneOverrides')[sceneKey]
    expect(delta.preserveMorphs).toEqual([{ name: 'body_ctrl_BreastsUp-Down', keepValue: 0.6 }])
    // The empty list is emitted so it OVERRIDES the base's [Left Eye] (delete-all).
    expect(delta.preserveNodeTransforms).toEqual([])
    expect(delta.extraFrames).toBeUndefined()
    expect(sceneOverrideBuildsRom(makeCharacter(), preserveOverride)).toBe(false)
  })

  // ── per-scene CONFIG overrides (mode / preset / art direction / jcm) ──────────
  // A female character whose GEN preset is ON → the base config includes the GP block.
  const genFemale = (extra: Partial<Character> = {}): Character =>
    makeCharacter({
      gender: 'female',
      extraScenes: [scene],
      sections: {
        ...defaultSections(),
        GEN: { enabled: true, mode: 'preset', presetAssets: [], artDirection: [], groups: [], customAssetPath: '' },
      },
      ...extra,
    })
  const ownedGenConfig = (patch: Record<string, unknown>) => ({
    enabled: true, mode: 'preset' as const, presetAssets: [], artDirection: [], groups: [], customAssetPath: '', ...patch,
  })

  it('disabling a preset GEN for a scene now emits bIncludeGP:false (v22 desync fix)', () => {
    const off = makeOverride({ scenePath: scene, rom: { GEN: { enabled: false } } })
    const files = generateAll(genFemale({ sceneOverrides: [off] }), {}, FRAMES)
    expect(grabObject(files[0].content, 'dthCharacterConfig').bIncludeGP).toBe(true)
    expect(grabObject(files[0].content, 'dthSceneOverrides')[sceneKey].bIncludeGP).toBe(false)
  })

  it('a per-scene preset-asset swap emits the changed include flags', () => {
    const swap = makeOverride({
      scenePath: scene,
      rom: { GEN: { owned: ownedGenConfig({ presetAssets: ['DK9 - Dicktator.duf'] }) } },
    })
    const delta = grabObject(generateAll(genFemale({ sceneOverrides: [swap] }), {}, FRAMES)[0].content, 'dthSceneOverrides')[sceneKey]
    expect(delta.bIncludeGP).toBe(false)
    expect(delta.bIncludeDK).toBe(true)
  })

  it('an art-direction-only scene override emits gpArtDirection but NO scene CSV', () => {
    const artB = { id: 'a', rom: 'gp' as const, frame: 96, name: 'Open', morphs: [{ id: 'm', node: 'GoldenPalace_G9', prop: 'GP_Open', value: 0.8 }] }
    const ov = makeOverride({ scenePath: scene, rom: { GEN: { owned: ownedGenConfig({ artDirection: [artB] }) } } })
    const files = generateAll(genFemale({ sceneOverrides: [ov] }), {}, FRAMES)
    // Art direction doesn't change the frame layout → no scene-suffixed CSV.
    expect(files.map((f) => f.fileName)).toEqual([
      'ROM_ElectraG9_G9.dsa',
      '.Build_ROM_Animation.dsa',
      'ElectraG9_pose_asset.csv',
    ])
    const delta = grabObject(files[0].content, 'dthSceneOverrides')[sceneKey]
    expect(delta.gpArtDirection).toBeDefined()
    expect(delta.extraFrames).toBeUndefined()
  })

  it('a jcm-only scene override emits jcmMorphMods but NO scene CSV', () => {
    const ov = makeOverride({
      scenePath: scene,
      jcm: [{ id: 'r1', boneLabel: 'Left Thigh', axis: 'XRotate', drives: [] }],
    })
    const files = generateAll(makeCharacter({ extraScenes: [scene], sceneOverrides: [ov] }), {}, FRAMES)
    expect(files.map((f) => f.fileName)).toEqual([
      'ROM_ElectraG9_G9.dsa',
      '.Build_ROM_Animation.dsa',
      'ElectraG9_pose_asset.csv',
    ])
    const delta = grabObject(files[0].content, 'dthSceneOverrides')[sceneKey]
    expect(delta.jcmMorphMods).toEqual([{ boneLabel: 'Left Thigh', axis: 'XRotate', positive: [], negative: [] }])
    expect(delta.extraFrames).toBeUndefined()
  })

  it('a jcm DELETE-ALL (armed, empty list) emits an empty jcmMorphMods delta', () => {
    // Mirrors the preserve delete-all above: a PRESENT jcm block with an EMPTY list must
    // still OVERRIDE the base's mods (empty ⇒ no JCM modifications for this scene) — the
    // shallow runtime copy can only set a key, so the empty array has to be emitted.
    const ov = makeOverride({ scenePath: scene, jcm: [] })
    const character = makeCharacter({
      extraScenes: [scene],
      jcmMorphMods: [{ id: 'base', boneLabel: 'Right Thigh', axis: 'XRotate', drives: [] }],
      sceneOverrides: [ov],
    })
    const delta = grabObject(generateAll(character, {}, FRAMES)[0].content, 'dthSceneOverrides')[sceneKey]
    expect(delta.jcmMorphMods).toEqual([])
  })

  it('a per-scene GEN mode preset→custom flips the include off AND mints a scene CSV', () => {
    // Owning GEN in custom mode changes the frame layout (custom rows replace the preset
    // block) — so the delta drops the GP include and a scene-suffixed CSV is minted.
    const owned = {
      enabled: true,
      mode: 'custom' as const,
      presetAssets: [],
      artDirection: [],
      groups: [
        {
          id: 'gg',
          label: '',
          suffix: 'centre' as const,
          method: 'individual' as const,
          calculateFrom: 'default' as const,
          poses: [{ id: 'gp1', name: 'BeachGP', morphs: [{ id: 'm', node: 'Genesis9', prop: 'p', value: 1 }], boneScaleRef: false }],
        },
      ],
      customAssetPath: '',
    }
    const ov = makeOverride({ scenePath: scene, rom: { GEN: { owned } } })
    const files = generateAll(genFemale({ sceneOverrides: [ov] }), {}, FRAMES)
    // Frame layout changed (custom GEN rows) → the scene gets its own CSV.
    expect(files.map((f) => f.fileName)).toContain('ElectraG9_ElectraBeach_pose_asset.csv')
    const delta = grabObject(files[0].content, 'dthSceneOverrides')[sceneKey]
    expect(delta.bIncludeGP).toBe(false) // custom GEN → no GP preset block for the scene
    expect(delta.extraFrames.frames.map((f: { name: string }) => f.name)).toContain('BeachGP')
    const csv = files.find((f) => f.fileName === 'ElectraG9_ElectraBeach_pose_asset.csv')!.content
    expect(csv).toContain('BeachGP')
  })

  it('a per-scene custom JCM path emits ONLY jcmRomPath in the delta (exact key set)', () => {
    // A custom base-ROM `.duf` for the scene rides as a jcmRomPath delta (forward-slashed);
    // the exact-key assertion pins that nothing else leaks into the delta.
    const owned = {
      enabled: true,
      mode: 'custom' as const,
      presetAssets: [],
      artDirection: [],
      groups: [],
      customAssetPath: 'C:\\Custom\\Beach JCM.duf',
    }
    const ov = makeOverride({ scenePath: scene, rom: { JCM: { owned } } })
    const delta = grabObject(generateAll(withScene({ sceneOverrides: [ov] }), {}, FRAMES)[0].content, 'dthSceneOverrides')[sceneKey]
    expect(Object.keys(delta)).toEqual(['jcmRomPath'])
    expect(delta.jcmRomPath).toBe('C:/Custom/Beach JCM.duf')
  })

  it('threads the HOST-resolved per-scene rom paths + preset frames into the delta', () => {
    // A scene that swaps GEN to the DK preset resolves a different `.duf` + block lengths
    // than the base — which only the host can measure. generateAll must carry the
    // per-scene maps through to the delta (the base romPaths {} / FRAMES carry neither).
    const ov = makeOverride({
      scenePath: scene,
      rom: {
        GEN: { owned: { enabled: true, mode: 'preset' as const, presetAssets: ['DK9 - Dicktator.duf'], artDirection: [], groups: [], customAssetPath: '' } },
      },
    })
    const sceneRomPaths = { [sceneKey]: { dk: 'X:/poses/DK.duf' } }
    const sceneFrames = { [sceneKey]: { base: 328, gp: 0, dk: 60, phys: 43 } }
    const script = generateAll(
      genFemale({ sceneOverrides: [ov] }),
      {},
      FRAMES,
      undefined,
      undefined,
      undefined,
      sceneRomPaths,
      sceneFrames,
    )[0].content
    const delta = grabObject(script, 'dthSceneOverrides')[sceneKey]
    expect(delta.dkRomPath).toBe('X:/poses/DK.duf') // host-resolved path reached the delta
    expect(delta.presetFrames.dk).toBe(60) // scene's own block frames, not the base's 54
  })
})
