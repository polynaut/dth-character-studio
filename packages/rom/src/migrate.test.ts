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

  it('renames resetGPBeforeApplying → resetGenBeforeApplying', () => {
    const data = migrateCharacterData({ sections: {}, resetGPBeforeApplying: false })
    expect(data.resetGenBeforeApplying).toBe(false)
    expect(data.resetGPBeforeApplying).toBeUndefined()
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
      resetGenBeforeApplying: true,
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
