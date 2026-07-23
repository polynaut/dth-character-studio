import { describe, expect, it } from 'vitest'

import { generateAll } from './generate'
import {
  activeSceneOverrides,
  applySceneOverride,
  clonePose,
  mergeSceneOverride,
  primaryRowsById,
  pruneSceneSections,
  sceneOverrideBuildsRom,
  sceneOverrideSlug,
  sceneRowOverridden,
  sceneSectionDiverged,
} from './scene-override'
import { characterSchema, defaultSections, sceneOverrideSchema } from './types'

import type { PresetFrames } from './frames'
import type { Character, RomGroup, RomPose, RomSections, SceneOverride } from './types'

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

/** A single-morph pose row, for building scene snapshots concisely. */
function pose(id: string, name: string, prop: string, value = 1): RomPose {
  return {
    id,
    name,
    morphs: [{ id: `m-${id}`, node: 'Genesis9', prop, value }],
    boneScaleRef: false,
  }
}

/** An FBM snapshot: the base group (id g1) carrying `poses` instead of the base rows. */
function fbmSnapshot(poses: Array<RomPose>): Partial<Record<'FBM', Array<RomGroup>>> {
  return { FBM: [{ ...fbmGroup(), poses }] }
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
  it('uses the scene snapshot for a section it has, the base for the rest', () => {
    const base = makeSections()
    const override = makeOverride({
      sections: fbmSnapshot([pose('p1', 'BeachBodyTone', 'body_bs_BeachTone', 0.5), fbmGroup().poses[1]]),
    })
    const merged = applySceneOverride(base, override)
    // FBM comes from the snapshot …
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['BeachBodyTone', 'GluteSize'])
    expect(merged.FBM.groups[0].poses[0].morphs[0].prop).toBe('body_bs_BeachTone')
    // … every other section inherits the base verbatim (the same object).
    expect(merged.GEN).toBe(base.GEN)
  })

  it('a section with NO snapshot inherits the primary groups', () => {
    const merged = applySceneOverride(makeSections(), makeOverride({ sections: {} }))
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['BodyTone', 'GluteSize'])
  })

  it('reorder / add / delete in the snapshot drive the merged sections freely', () => {
    // Delete GluteSize, reorder, add a clothing frame — none of which the old
    // poses/additions deltas could express.
    const override = makeOverride({
      sections: fbmSnapshot([
        pose('a1', 'BeachDress', 'dress_bs_Flow'),
        fbmGroup().poses[0], // BodyTone, now second
      ]),
    })
    const merged = applySceneOverride(makeSections(), override)
    expect(merged.FBM.groups[0].poses.map((p) => p.name)).toEqual(['BeachDress', 'BodyTone'])
  })

  it('never mutates the base sections', () => {
    const sections = makeSections()
    const before = structuredClone(sections)
    applySceneOverride(sections, makeOverride({ sections: fbmSnapshot([pose('p1', 'Changed', 'x')]) }))
    expect(sections).toEqual(before)
  })
})

describe('sceneSectionDiverged', () => {
  const base = makeSections()
  it('is false for a section with no snapshot', () => {
    expect(sceneSectionDiverged(base, makeOverride({ sections: {} }), 'FBM')).toBe(false)
  })
  it('is false when only a row CONTENT differs (that is a per-row mark)', () => {
    const override = makeOverride({
      sections: fbmSnapshot([pose('p1', 'BeachBodyTone', 'body_bs_BeachTone', 0.5), fbmGroup().poses[1]]),
    })
    expect(sceneSectionDiverged(base, override, 'FBM')).toBe(false)
  })
  it('is true when a row is added (count differs)', () => {
    const override = makeOverride({
      sections: fbmSnapshot([...fbmGroup().poses, pose('a1', 'BeachDress', 'dress_bs_Flow')]),
    })
    expect(sceneSectionDiverged(base, override, 'FBM')).toBe(true)
  })
  it('is true when rows are reordered', () => {
    const override = makeOverride({
      sections: fbmSnapshot([fbmGroup().poses[1], fbmGroup().poses[0]]),
    })
    expect(sceneSectionDiverged(base, override, 'FBM')).toBe(true)
  })
})

describe('sceneRowOverridden', () => {
  const byId = primaryRowsById(makeSections())
  it('flags an added row (no primary twin)', () => {
    expect(sceneRowOverridden(byId, pose('a1', 'BeachDress', 'dress_bs_Flow'))).toBe(true)
  })
  it('flags a row whose content differs from its twin', () => {
    expect(sceneRowOverridden(byId, pose('p1', 'BodyTone', 'body_bs_BodyTone', 0.5))).toBe(true)
  })
  it('does NOT flag a row identical to its twin (ignoring grid ids)', () => {
    const twin = clonePose(fbmGroup().poses[0])
    twin.morphs[0].id = 'different-grid-id'
    expect(sceneRowOverridden(byId, twin)).toBe(false)
  })
})

describe('pruneSceneSections', () => {
  const base = makeSections()
  it('drops a snapshot equal to the base and clears the enabled gate', () => {
    const override = makeOverride({ sections: fbmSnapshot([...fbmGroup().poses]) })
    const pruned = pruneSceneSections(base, override)
    expect(pruned.sections.FBM).toBeUndefined()
    expect(pruned.enabled).toBe(false)
  })
  it('keeps a diverging snapshot and arms the enabled gate', () => {
    const override = makeOverride({
      enabled: false,
      sections: fbmSnapshot([pose('p1', 'BeachBodyTone', 'body_bs_BeachTone', 0.5), fbmGroup().poses[1]]),
    })
    const pruned = pruneSceneSections(base, override)
    expect(pruned.sections.FBM).toBeDefined()
    expect(pruned.enabled).toBe(true)
  })
  it('leaves the identity / preserve blocks untouched', () => {
    const override = makeOverride({
      sections: {},
      identity: { enabled: true, facsDetailStrength: 0.5, flexionStrength: 1, applyUE5TearUV: false },
    })
    const pruned = pruneSceneSections(base, override)
    expect(pruned.identity.enabled).toBe(true)
    expect(pruned.identity.facsDetailStrength).toBe(0.5)
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
  // A scene that replaces BodyTone's content (same p1 id) and appends a clothing
  // frame — the merged FBM is [BeachBodyTone, GluteSize, BeachDress].
  const override = makeOverride({
    scenePath: scene,
    sections: fbmSnapshot([
      pose('p1', 'BeachBodyTone', 'body_bs_BeachTone', 0.5),
      fbmGroup().poses[1],
      { id: 'a1', name: 'BeachDress', morphs: [{ id: 'ma2', node: 'BeachDress', prop: 'dress_bs_Flow', value: 1 }], boneScaleRef: false },
    ]),
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

  it('MULTIPLE overrides fold into the ONE script: each scene selectable + its own CSV', () => {
    const beach = 'D:\\scenes\\Electra Beach.duf'
    const office = 'D:\\scenes\\Electra Office.duf'
    const beachKey = 'd:/scenes/electra beach.duf'
    const officeKey = 'd:/scenes/electra office.duf'
    const romOverride = (path: string, poseName: string) =>
      makeOverride({
        scenePath: path,
        sections: fbmSnapshot([pose('p1', poseName, 'p'), fbmGroup().poses[1]]),
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

  it('mergeSceneOverride merges the ROM sections only (frames), not identity dials', () => {
    const romOverride = makeOverride({
      scenePath: scene,
      sections: fbmSnapshot([pose('p1', 'BeachTone', 'b', 0.5), fbmGroup().poses[1]]),
      identity: { enabled: true, facsDetailStrength: 0.25, flexionStrength: 0.75, applyUE5TearUV: true },
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
      enabled: false,
      preserve: {
        enabled: true,
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
    expect(files.map((f) => f.fileName)).toEqual(['ROM_ElectraG9_G9.dsa', 'ElectraG9_pose_asset.csv'])
    const delta = grabObject(files[0].content, 'dthSceneOverrides')[sceneKey]
    expect(delta.preserveMorphs).toEqual([{ name: 'body_ctrl_BreastsUp-Down', keepValue: 0.6 }])
    // The empty list is emitted so it OVERRIDES the base's [Left Eye] (delete-all).
    expect(delta.preserveNodeTransforms).toEqual([])
    expect(delta.extraFrames).toBeUndefined()
    expect(sceneOverrideBuildsRom(preserveOverride)).toBe(false)
  })
})
