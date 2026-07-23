import { describe, expect, it } from 'vitest'

import {
  CharacterSchemaTooNewError,
  migrateCharacterData,
  normalizeLegacyCharacter,
} from './migrate'
import { toCharacterScriptDsa } from './generate'
import {
  CHARACTER_SCHEMA_VERSION,
  characterSchema,
  jcmMorphModForRuntime,
  romGroupSchema,
} from './types'

describe('migrateCharacterData — non-object input', () => {
  it('flows into a clean zod failure instead of a TypeError in the normalizer', () => {
    for (const bad of [null, undefined, 'a string', 42, ['an', 'array']]) {
      const migrated = migrateCharacterData(bad)
      expect(typeof migrated).toBe('object')
      // The empty result then fails validation with zod's usual required-field
      // errors — the same "unreadable definition" path a corrupt JSON takes.
      expect(characterSchema.safeParse(migrated).success).toBe(false)
    }
  })
})

describe('migrateCharacterData — pre-versioning normalization', () => {
  it('expands a GEN presetVariant into the selected preset assets', () => {
    expect(migrateCharacterData({ sections: { GEN: { presetVariant: 'both' } } }).sections.GEN.presetAssets).toEqual(
      ['GP9 - Golden Palace.duf', 'DK9 - Dicktator.duf'],
    )
    expect(migrateCharacterData({ sections: { GEN: { presetVariant: 'dk' } } }).sections.GEN.presetAssets).toEqual([
      'DK9 - Dicktator.duf',
    ])
    expect(migrateCharacterData({ sections: { GEN: { presetVariant: 'gp' } } }).sections.GEN.presetAssets).toEqual([
      'GP9 - Golden Palace.duf',
    ])
  })

  it('does not clobber preset assets the user already chose', () => {
    const data = migrateCharacterData({
      sections: { GEN: { presetVariant: 'both', presetAssets: ['DK9 - Dicktator.duf'] } },
    })
    expect(data.sections.GEN.presetAssets).toEqual(['DK9 - Dicktator.duf'])
  })

  it('expands presetVariant when presetAssets exists but is EMPTY (transitional file)', () => {
    // A build that added the presetAssets field before the fold ran wrote
    // `presetAssets: []` next to the legacy presetVariant. The old presence-only
    // guard (`!gen.presetAssets`) saw the empty array as "already chosen" and
    // silently discarded the user's GEN selection.
    const data = migrateCharacterData({
      sections: { GEN: { presetVariant: 'dk', presetAssets: [] } },
    })
    expect(data.sections.GEN.presetAssets).toEqual(['DK9 - Dicktator.duf'])
  })

  it('migrates a "none" group suffix to "centre"', () => {
    const data = migrateCharacterData({
      sections: { MISC: { enabled: true, mode: 'custom', groups: [{ suffix: 'none' }, { suffix: 'left' }] } },
    })
    expect(data.sections.MISC.groups.map((g: { suffix: string }) => g.suffix)).toEqual(['centre', 'left'])
  })

  it('folds legacy flat `groups` into the sections model and drops the old keys', () => {
    const data = migrateCharacterData({ groups: [{ section: 'JCM', label: 'mine' }] })
    expect(data.sections.JCM.enabled).toBe(true)
    expect(data.sections.JCM.mode).toBe('custom')
    // A stable id is minted during the fold — `romGroupSchema.id` has no zod
    // default, so a folded group lacking one would fail the whole character
    // parse ("unreadable definition").
    expect(data.sections.JCM.groups).toHaveLength(1)
    expect(data.sections.JCM.groups[0].label).toBe('mine')
    expect(typeof data.sections.JCM.groups[0].id).toBe('string')
    expect(data.groups).toBeUndefined()
    expect(data.options).toBeUndefined()
  })

  it('folds legacy poses with minted ids so the folded group parses through the schema', () => {
    const data = migrateCharacterData({
      groups: [
        {
          section: 'MISC',
          label: 'g',
          poses: [{ name: 'Pose', morphs: [{ node: 'Genesis9', prop: 'body_bs_A', value: 1 }] }],
        },
      ],
    })
    const group = data.sections.MISC.groups[0]
    expect(typeof group.poses[0].id).toBe('string')
    // `romGroupSchema.id` / `romPoseSchema.id` have no zod default, so before the
    // fix this folded group failed to parse ("unreadable definition").
    expect(romGroupSchema.safeParse(group).success).toBe(true)
  })

  it('routes an unknown section to MISC', () => {
    const data = migrateCharacterData({ groups: [{ section: 'NOPE', label: 'x' }] })
    expect(data.sections.MISC.groups).toHaveLength(1)
    expect(data.sections.MISC.groups[0].label).toBe('x')
    expect(typeof data.sections.MISC.groups[0].id).toBe('string')
  })

  it('skips null/non-object group entries instead of throwing (hand-edited JSON)', () => {
    // migrateCharacterData promises malformed data flows into the clean zod
    // "unreadable definition" failure — a null entry in a section's groups (or
    // in the legacy flat `groups` list) must not become a raw TypeError inside
    // the normalizer. The junk entry is left in place for zod to reject.
    const data = migrateCharacterData({
      sections: {
        MISC: { enabled: true, mode: 'custom', groups: [null, { suffix: 'none' }, 'junk'] },
      },
    })
    // The valid sibling still migrates; the junk stays for zod.
    expect(data.sections.MISC.groups[1].suffix).toBe('centre')
    expect(data.sections.MISC.groups[0]).toBeNull()

    // Legacy flat-groups fold: the null entry is dropped, the valid one folds.
    const folded = migrateCharacterData({ groups: [null, { section: 'JCM', label: 'mine' }] })
    expect(folded.sections.JCM.groups).toHaveLength(1)
    expect(folded.sections.JCM.groups[0].label).toBe('mine')
  })
})

describe('schema v17 — sceneOverrides (additive, zod default)', () => {
  it('fills an empty list on definitions written before v17', () => {
    const now = '2026-07-20T00:00:00.000Z'
    const parsed = characterSchema.parse(
      migrateCharacterData({
        id: 'c',
        name: 'X',
        createdAt: now,
        updatedAt: now,
        sections: {},
        schemaVersion: 16,
      }),
    )
    expect(parsed.sceneOverrides).toEqual([])
  })
})

describe('schema v21 — sceneOverride.sectionOverrides (additive, zod default)', () => {
  it('fills an empty list on a legacy sceneOverride (pre-v21)', () => {
    const now = '2026-07-20T00:00:00.000Z'
    const parsed = characterSchema.parse(
      migrateCharacterData({
        id: 'c',
        name: 'X',
        createdAt: now,
        updatedAt: now,
        sections: {},
        schemaVersion: 20,
        sceneOverrides: [{ scenePath: 'D:/s.duf', enabled: true, poses: [], additions: [] }],
      }),
    )
    expect(parsed.sceneOverrides[0].sectionOverrides).toEqual([])
  })
})

describe('schema v20 — per-scene identity/groom override blocks (additive, zod default)', () => {
  const now = '2026-07-20T00:00:00.000Z'
  it('fills identity + groom defaults on a legacy sceneOverride (pre-v20)', () => {
    const parsed = characterSchema.parse(
      migrateCharacterData({
        id: 'c',
        name: 'X',
        createdAt: now,
        updatedAt: now,
        sections: {},
        schemaVersion: 19,
        sceneOverrides: [{ scenePath: 'D:/s.duf', enabled: true, poses: [], additions: [] }],
      }),
    )
    expect(parsed.sceneOverrides[0].identity).toEqual({
      enabled: false,
      facsDetailStrength: 1,
      flexionStrength: 1,
      applyUE5TearUV: false,
    })
    expect(parsed.sceneOverrides[0].groom).toEqual({ enabled: false })
    expect(parsed.sceneOverrides[0].preserve).toEqual({
      enabled: false,
      morphs: [],
      nodeTransforms: [],
    })
  })
  it('round-trips explicit identity + groom override values', () => {
    const parsed = characterSchema.parse(
      migrateCharacterData({
        id: 'c',
        name: 'X',
        createdAt: now,
        updatedAt: now,
        sections: {},
        schemaVersion: CHARACTER_SCHEMA_VERSION,
        sceneOverrides: [
          {
            scenePath: 'D:/s.duf',
            identity: {
              enabled: true,
              facsDetailStrength: 0.5,
              flexionStrength: 0.75,
              applyUE5TearUV: true,
            },
            groom: { enabled: true },
          },
        ],
      }),
    )
    expect(parsed.sceneOverrides[0].identity).toEqual({
      enabled: true,
      facsDetailStrength: 0.5,
      flexionStrength: 0.75,
      applyUE5TearUV: true,
    })
    expect(parsed.sceneOverrides[0].groom.enabled).toBe(true)
  })

  // The ROM `enabled` gate's default flipped true → false at v20 (fresh override
  // = fully disabled). The v20 migrate step keeps a PRE-v20 override that omits
  // `enabled` ACTIVE, so the flip can't silently deactivate a stored scene's ROM
  // override (a quiet frame regression next to the core invariant).
  it('a pre-v20 override missing `enabled` heals to ACTIVE (old default preserved)', () => {
    const parsed = characterSchema.parse(
      migrateCharacterData({
        id: 'c',
        name: 'X',
        createdAt: now,
        updatedAt: now,
        sections: {},
        schemaVersion: 19,
        sceneOverrides: [{ scenePath: 'D:/s.duf' }],
      }),
    )
    expect(parsed.sceneOverrides[0].enabled).toBe(true)
  })

  it('a v20+ bare override defaults to DISABLED (the new default, no step)', () => {
    const parsed = characterSchema.parse(
      migrateCharacterData({
        id: 'c',
        name: 'X',
        createdAt: now,
        updatedAt: now,
        sections: {},
        schemaVersion: CHARACTER_SCHEMA_VERSION,
        sceneOverrides: [{ scenePath: 'D:/s.duf' }],
      }),
    )
    expect(parsed.sceneOverrides[0].enabled).toBe(false)
  })
})

describe('migrateCharacterData — version handling', () => {
  it('leaves the stored schemaVersion untouched (bumping happens on save)', () => {
    expect(migrateCharacterData({ sections: {}, schemaVersion: 3 }).schemaVersion).toBe(3)
    expect(migrateCharacterData({ sections: {} }).schemaVersion).toBeUndefined()
  })

  it('is a no-op for an already-current shape', () => {
    const current = {
      sections: { GEN: { enabled: false, mode: 'preset', presetAssets: ['GP9 - Golden Palace.duf'], groups: [] } },
      schemaVersion: CHARACTER_SCHEMA_VERSION,
    }
    expect(migrateCharacterData(structuredClone(current))).toEqual(current)
  })

  it('is idempotent — migrating twice yields the same result', () => {
    const once = migrateCharacterData({ groups: [{ section: 'FAC', label: 'a' }], resetGPBeforeApplying: true })
    const twice = migrateCharacterData(structuredClone(once))
    expect(twice).toEqual(once)
  })

  it('does not hang on a corrupt hugely-negative schemaVersion (clamped to 1)', () => {
    // Without the clamp, `for (v = from+1; v <= CURRENT; v++)` from -9e15 spins
    // ~9 quadrillion times and hangs the app at project open (migration runs on
    // every read). The clamp makes this return promptly and run every step.
    const started = performance.now()
    const data = migrateCharacterData({ sections: {}, schemaVersion: -9_000_000_000_000_000 })
    expect(performance.now() - started).toBeLessThan(1000)
    expect(typeof data).toBe('object')
  })

  it('treats a fractional schemaVersion as corrupt (clamped, never a throw)', () => {
    // A fractional version must not silently skip integer steps between floor+1
    // and CURRENT — it collapses to 1 and re-runs every (idempotent) step. Even
    // a fractional value ABOVE current is corruption, not provenance, so it
    // clamps instead of throwing the too-new error.
    expect(() => migrateCharacterData({ sections: {}, schemaVersion: 9.5 })).not.toThrow()
    expect(() =>
      migrateCharacterData({ sections: {}, schemaVersion: CHARACTER_SCHEMA_VERSION + 0.5 }),
    ).not.toThrow()
  })

  it('throws CharacterSchemaTooNewError for a file saved by a newer build', () => {
    // The old Math.min clamp was a SILENT DOWNGRADE: zod stripped the newer
    // build's fields and the next save destroyed them. Fail loud instead.
    const newer = CHARACTER_SCHEMA_VERSION + 5
    let thrown: unknown
    try {
      migrateCharacterData({ sections: {}, schemaVersion: newer })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(CharacterSchemaTooNewError)
    const error = thrown as CharacterSchemaTooNewError
    expect(error.name).toBe('CharacterSchemaTooNewError')
    expect(error.storedVersion).toBe(newer)
    expect(error.supportedVersion).toBe(CHARACTER_SCHEMA_VERSION)
    expect(error.message).toContain(`schema v${newer}`)
    expect(error.message).toContain(`up to v${CHARACTER_SCHEMA_VERSION}`)
    expect(error.message).toMatch(/newer version/i)
    // The boundary itself is fine: exactly-current runs (and is a no-op).
    expect(() =>
      migrateCharacterData({ sections: {}, schemaVersion: CHARACTER_SCHEMA_VERSION }),
    ).not.toThrow()
    expect(() =>
      migrateCharacterData({ sections: {}, schemaVersion: CHARACTER_SCHEMA_VERSION + 1 }),
    ).toThrow(CharacterSchemaTooNewError)
  })

  it('allowDowngrade forces a newer-build file to the current shape, dropping its newer fields', () => {
    // The recovery escape hatch (web: resetDefinitionToCurrentVersion): a dev ran a
    // schema-bump branch, then went back to an older build. The file must be
    // openable again by DELIBERATELY discarding the fields this build never knew.
    const newer = CHARACTER_SCHEMA_VERSION + 3
    const raw = {
      id: 'c1',
      name: 'Electra',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      schemaVersion: newer,
      // A field a future build added that this build's schema knows nothing about.
      somethingFromTheFuture: { nested: [1, 2, 3] },
    }
    // The safe default is unchanged — without the opt-in it still refuses.
    expect(() => migrateCharacterData(raw)).toThrow(CharacterSchemaTooNewError)
    // With allowDowngrade it does NOT throw, and zod then strips the unknown newer
    // field, leaving a valid current-shape definition.
    const parsed = characterSchema.parse(migrateCharacterData(raw, { allowDowngrade: true }))
    expect(parsed).not.toHaveProperty('somethingFromTheFuture')
    expect(parsed.name).toBe('Electra')
  })
})

// v11 removed `resetGenBeforeApplying` (runtime v26+ always closes the block
// tails — leaking was never a sane choice) — a removal, so there is no migrate
// step; zod strips the stored key on read. The old pre-rename spelling
// (`resetGPBeforeApplying`, once mapped in normalizeLegacyCharacter) is stripped
// the same way now that its target field is gone. This is the "ritual" test for
// that change.
describe('characterSchema — v11 resetGenBeforeApplying removal', () => {
  const base = { id: 'c1', name: 'Electra', createdAt: '2026-01-01', updatedAt: '2026-01-01' }

  it('strips the stored flag from an older definition', () => {
    const parsed = characterSchema.parse({ ...base, schemaVersion: 10, resetGenBeforeApplying: false })
    expect('resetGenBeforeApplying' in parsed).toBe(false)
  })

  it('strips the ancient pre-rename spelling too (migrate + parse, no crash)', () => {
    const migrated = migrateCharacterData({ resetGPBeforeApplying: false })
    const parsed = characterSchema.parse({ ...base, ...migrated })
    expect('resetGenBeforeApplying' in parsed).toBe(false)
    expect('resetGPBeforeApplying' in parsed).toBe(false)
  })
})

// v12 added `imageScene` (the linked scene whose preview the avatar mirrors) —
// additive with a '' default, so there is no migrate step; zod fills it when
// reading an older definition. This is the "ritual" test for that change.
describe('characterSchema — v12 imageScene (additive)', () => {
  const base = { id: 'c1', name: 'Electra', createdAt: '2026-01-01', updatedAt: '2026-01-01' }

  it("fills imageScene with '' for a v11-shaped definition", () => {
    expect(characterSchema.parse({ ...base, schemaVersion: 11 }).imageScene).toBe('')
  })

  it('round-trips a stored source scene', () => {
    const parsed = characterSchema.parse({ ...base, imageScene: 'X:/proj/Karen/daz3d/Karen.duf' })
    expect(parsed.imageScene).toBe('X:/proj/Karen/daz3d/Karen.duf')
  })
})

// v15 replaced the flat groomNodes with per-scene `groomScenes` (additive with
// a [] default; the never-released flat list is stripped by zod on read).
describe('characterSchema — v15 groomScenes (additive)', () => {
  const base = { id: 'c1', name: 'Electra', createdAt: '2026-01-01', updatedAt: '2026-01-01' }

  it('fills groomScenes with [] and strips the old flat groomNodes', () => {
    const parsed = characterSchema.parse({
      ...base,
      schemaVersion: 13,
      groomNodes: [{ nodeLabel: 'Old Cap' }],
    })
    expect(parsed.groomScenes).toEqual([])
    expect('groomNodes' in parsed).toBe(false)
  })

  it('round-trips per-scene groom lists', () => {
    const parsed = characterSchema.parse({
      ...base,
      groomScenes: [{ scenePath: 'X:/scenes/Karen.duf', nodes: [{ nodeLabel: 'dForce Black Tie Cap' }] }],
    })
    expect(parsed.groomScenes[0].nodes[0].nodeLabel).toBe('dForce Black Tie Cap')
  })
})

// v20 REMOVED `groomMode`: hair is per-scene by presence now. A removed field
// needs no migrate step — zod strips the old value on read.
describe('characterSchema — v20 groomMode removal', () => {
  const base = { id: 'c1', name: 'Electra', createdAt: '2026-01-01', updatedAt: '2026-01-01' }

  it('strips a stored groomMode instead of carrying it', () => {
    const parsed = characterSchema.parse({ ...base, groomMode: 'separate' }) as Record<string, unknown>
    expect(parsed.groomMode).toBeUndefined()
  })
})

// v8 added `products` / `productsUnmatched` / `productsScannedAt` — additive with
// [] / '' defaults, so there is no migrate step; zod fills them when reading an
// older (v7-shaped) definition. This is the "ritual" test for that change.
describe('characterSchema — v8 product fields (additive)', () => {
  const base = { id: 'c1', name: 'Electra', createdAt: '2026-01-01', updatedAt: '2026-01-01' }

  it('fills product fields with defaults for a v7-shaped definition', () => {
    // A v7 JSON has none of the v8 keys; zod supplies the defaults on read.
    const parsed = characterSchema.parse({ ...base, schemaVersion: 7 })
    expect(parsed.products).toEqual([])
    expect(parsed.productsUnmatched).toEqual([])
    expect(parsed.productsScannedAt).toBe('')
  })

  it('round-trips stored product + unmatched records', () => {
    const parsed = characterSchema.parse({
      ...base,
      products: [
        { name: 'Golden Palace', sku: '2254-1', artist: 'Meipe', version: '1.0', productType: 'Anatomy', matchMethod: 'SKU Match' },
      ],
      productsUnmatched: [{ name: 'Some Prop', technicalName: 'someProp_1234', assetType: 'Node' }],
      productsScannedAt: '2026-06-28T00:00:00.000Z',
    })
    expect(parsed.products[0].sku).toBe('2254-1')
    expect(parsed.productsUnmatched[0].assetType).toBe('Node')
    expect(parsed.productsScannedAt).toBe('2026-06-28T00:00:00.000Z')
  })
})

// v9 added `applyUE5TearUV` — additive with a `false` default, so there is no
// migrate step; zod fills it when reading an older (v8-shaped) definition.
describe('characterSchema — v9 applyUE5TearUV (additive)', () => {
  const base = { id: 'c1', name: 'Electra', createdAt: '2026-01-01', updatedAt: '2026-01-01' }

  it('defaults applyUE5TearUV to false for a v8-shaped definition', () => {
    const parsed = characterSchema.parse({ ...base, schemaVersion: 8 })
    expect(parsed.applyUE5TearUV).toBe(false)
  })

  it('round-trips a stored true value', () => {
    const parsed = characterSchema.parse({ ...base, applyUE5TearUV: true })
    expect(parsed.applyUE5TearUV).toBe(true)
  })
})

// v10 renamed the per-pose `referenceFbx` string to a `boneScaleRef` boolean — a
// rename/restructure (Case A), so it carries a registered step. A non-empty old
// path means the pose was a reference-skeleton frame.
describe('migrateCharacterData — v10 (referenceFbx → boneScaleRef)', () => {
  const poseWith = (referenceFbx: string) => ({
    sections: {
      FBM: {
        enabled: true,
        mode: 'custom',
        groups: [{ poses: [{ id: 'p', name: 'X', morphs: [], referenceFbx }] }],
      },
    },
    schemaVersion: 9,
  })

  it('turns a non-empty reference FBX path into boneScaleRef: true', () => {
    const pose = migrateCharacterData(poseWith('ProportionHeight.fbx')).sections.FBM.groups[0].poses[0]
    expect(pose.boneScaleRef).toBe(true)
    expect(pose.referenceFbx).toBeUndefined()
  })

  it('turns an empty (or whitespace) path into boneScaleRef: false', () => {
    const pose = migrateCharacterData(poseWith('   ')).sections.FBM.groups[0].poses[0]
    expect(pose.boneScaleRef).toBe(false)
    expect(pose.referenceFbx).toBeUndefined()
  })

  it('is idempotent — migrating twice yields the same result', () => {
    const once = migrateCharacterData(poseWith('a.fbx'))
    const twice = migrateCharacterData(structuredClone(once))
    expect(twice).toEqual(once)
    expect(twice.sections.FBM.groups[0].poses[0].boneScaleRef).toBe(true)
  })
})

describe('normalizeLegacyCharacter', () => {
  it('is exported for direct use and returns the same (mutated) object', () => {
    const input = { sections: { GEN: { presetVariant: 'gp' } } }
    const out = normalizeLegacyCharacter(input)
    expect(out).toBe(input)
    expect(out.sections.GEN.presetAssets).toEqual(['GP9 - Golden Palace.duf'])
  })
})

// v16 restructured a JCM "Modify frames" rule from split positive[]/negative[]
// drive lists to one signed drives[] — direction is inferred from the angle sign
// now (Case A, carries a step). The two lists concatenate; the old keys are dropped.
describe('migrateCharacterData — v16 (JCM positive/negative → drives)', () => {
  const modWith = () => ({
    schemaVersion: 15,
    jcmMorphMods: [
      {
        boneLabel: 'Left Thigh',
        axis: 'XRotate',
        positive: [
          { morphName: 'A', range: { angle: { start: 0, end: 90 }, value: { start: 0, end: 1 } } },
        ],
        negative: [
          { morphName: 'B', range: { angle: { start: 0, end: -115 }, value: { start: 0, end: 0.33 } } },
        ],
      },
    ],
  })

  it('merges positive + negative into one drives[] and drops the old keys', () => {
    const mod = migrateCharacterData(modWith()).jcmMorphMods[0]
    expect(mod.drives.map((d: { morphName: string }) => d.morphName)).toEqual(['A', 'B'])
    expect(mod.positive).toBeUndefined()
    expect(mod.negative).toBeUndefined()
  })

  it('is idempotent — migrating twice yields the same result', () => {
    const once = migrateCharacterData(modWith())
    const twice = migrateCharacterData(structuredClone(once))
    expect(twice).toEqual(once)
    expect(twice.jcmMorphMods[0].drives).toHaveLength(2)
  })
})

describe('schema v18 — stable ids on JCM rules + drives (additive, zod default)', () => {
  it('mints a rule id and a drive id when a pre-v18 definition lacks them', () => {
    const now = '2026-07-21T00:00:00.000Z'
    const parsed = characterSchema.parse(
      migrateCharacterData({
        id: 'c',
        name: 'X',
        createdAt: now,
        updatedAt: now,
        sections: {},
        schemaVersion: 17,
        jcmMorphMods: [
          {
            boneLabel: 'Left Thigh',
            axis: 'XRotate',
            drives: [
              { morphName: 'A', range: { angle: { start: 0, end: 90 }, value: { start: 0, end: 1 } } },
            ],
          },
        ],
      }),
    )
    expect(typeof parsed.jcmMorphMods[0].id).toBe('string')
    expect(parsed.jcmMorphMods[0].id).not.toBe('')
    expect(typeof parsed.jcmMorphMods[0].drives[0].id).toBe('string')
    expect(parsed.jcmMorphMods[0].drives[0].id).not.toBe('')
  })

  it('the minted ids never reach the generated runtime output', () => {
    const runtime = jcmMorphModForRuntime({
      id: 'rule-1',
      boneLabel: 'Left Thigh',
      axis: 'XRotate',
      drives: [
        { id: 'drive-1', morphName: 'A', range: { angle: { start: 0, end: 90 }, value: { start: 0, end: 1 } } },
      ],
    })
    // Neither the rule id nor the drive id appears in what generation emits.
    expect(JSON.stringify(runtime)).not.toContain('rule-1')
    expect(JSON.stringify(runtime)).not.toContain('drive-1')
    expect('id' in runtime.positive[0]).toBe(false)
  })
})

describe('schema v19 — stable ids on pose + art-direction morph rows (additive, zod default)', () => {
  const now = '2026-07-21T00:00:00.000Z'
  const v18Character = (): Record<string, any> => ({
    id: 'c',
    name: 'X',
    createdAt: now,
    updatedAt: now,
    schemaVersion: 18,
    sections: {
      FBM: {
        enabled: true,
        mode: 'custom',
        groups: [
          {
            id: 'g1',
            poses: [
              {
                id: 'p1',
                name: 'BodyTone',
                morphs: [{ node: 'Genesis9', prop: 'body_bs_BodyTone', value: 1 }],
              },
            ],
          },
        ],
      },
      GEN: {
        enabled: true,
        mode: 'preset',
        artDirection: [
          {
            id: 'a1',
            rom: 'gp',
            frame: 100,
            name: 'AnusOpen',
            morphs: [{ node: 'GoldenPalace_G9', prop: 'GP9_Anus_Open', value: 0.9 }],
          },
        ],
      },
    },
  })

  it('mints morph ids on pose AND art-direction rows when a pre-v19 definition lacks them', () => {
    const parsed = characterSchema.parse(migrateCharacterData(v18Character()))
    const poseMorph = parsed.sections.FBM.groups[0].poses[0].morphs[0]
    const artMorph = parsed.sections.GEN.artDirection[0].morphs[0]
    expect(typeof poseMorph.id).toBe('string')
    expect(poseMorph.id).not.toBe('')
    expect(typeof artMorph.id).toBe('string')
    expect(artMorph.id).not.toBe('')
  })

  it('keeps a stored morph id (parse → parse is stable once saved)', () => {
    const raw = v18Character()
    raw.sections.FBM.groups[0].poses[0].morphs[0] = {
      ...raw.sections.FBM.groups[0].poses[0].morphs[0],
      id: 'kept-morph-id',
    }
    const parsed = characterSchema.parse(migrateCharacterData(raw))
    expect(parsed.sections.FBM.groups[0].poses[0].morphs[0].id).toBe('kept-morph-id')
    // Idempotence in the saved state: re-parsing the parsed result changes nothing.
    const again = characterSchema.parse(migrateCharacterData(structuredClone(parsed)))
    expect(again).toEqual(parsed)
  })

  it('the minted ids never reach the generated output (extraFrames + art direction)', () => {
    const character = characterSchema.parse(migrateCharacterData(v18Character()))
    const script = toCharacterScriptDsa(character).content
    const mintedIds = [
      character.sections.FBM.groups[0].poses[0].morphs[0].id,
      character.sections.GEN.artDirection[0].morphs[0].id,
    ]
    for (const id of mintedIds) expect(script).not.toContain(id)
    // The emitted morph objects carry exactly the runtime fields — no `id` key
    // anywhere in the config JSON's morph rows.
    expect(script).not.toMatch(/"id":/)
  })
})

// ── REFERENCE: how to test a registered `characterMigrations[N]` step ─────────
// When you add a step in migrate.ts (a rename/restructure — Case A — or a computed
// value — Case B), add a describe block like this one alongside it. Assert the
// three things every step must get right: it transforms old data, it leaves
// already-current data alone, and it is idempotent. Example for a hypothetical v7
// that renamed `oldName` → `newName`:
//
//   describe('migrateCharacterData — v7 (oldName → newName)', () => {
//     it('renames the field on an old definition', () => {
//       const data = migrateCharacterData({ sections: {}, schemaVersion: 6, oldName: 'x' })
//       expect(data.newName).toBe('x')
//       expect(data.oldName).toBeUndefined()
//     })
//     it('does not run on definitions already at v7+', () => {
//       const data = migrateCharacterData({ sections: {}, schemaVersion: 7, newName: 'y' })
//       expect(data.newName).toBe('y')
//     })
//     it('is idempotent', () => {
//       const once = migrateCharacterData({ sections: {}, schemaVersion: 6, oldName: 'x' })
//       expect(migrateCharacterData(structuredClone(once))).toEqual(once)
//     })
//   })
