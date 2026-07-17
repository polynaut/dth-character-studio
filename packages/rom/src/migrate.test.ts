import { describe, expect, it } from 'vitest'

import { migrateCharacterData, normalizeLegacyCharacter } from './migrate'
import { CHARACTER_SCHEMA_VERSION, characterSchema } from './types'

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
    expect(data.sections.JCM.groups).toEqual([{ label: 'mine' }])
    expect(data.groups).toBeUndefined()
    expect(data.options).toBeUndefined()
  })

  it('routes an unknown section to MISC', () => {
    const data = migrateCharacterData({ groups: [{ section: 'NOPE', label: 'x' }] })
    expect(data.sections.MISC.groups).toEqual([{ label: 'x' }])
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

// v13 added `groomNodes` (hair items excluded from the DTH export) — additive
// with a [] default, so there is no migrate step; zod fills it when reading an
// older definition. This is the "ritual" test for that change.
describe('characterSchema — v13 groomNodes (additive)', () => {
  const base = { id: 'c1', name: 'Electra', createdAt: '2026-01-01', updatedAt: '2026-01-01' }

  it('fills groomNodes with [] for a v12-shaped definition', () => {
    expect(characterSchema.parse({ ...base, schemaVersion: 12 }).groomNodes).toEqual([])
  })

  it('round-trips stored groom items', () => {
    const parsed = characterSchema.parse({
      ...base,
      groomNodes: [{ nodeLabel: 'dForce Black Tie Cap' }, { nodeLabel: 'Ponytail' }],
    })
    expect(parsed.groomNodes).toEqual([{ nodeLabel: 'dForce Black Tie Cap' }, { nodeLabel: 'Ponytail' }])
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
