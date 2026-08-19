import { describe, expect, it } from 'vitest'

import { autoExportHair, detectedHairLabels, groomCandidates, seedSceneHair } from './groom-detect.ts'

import type { SceneWearable } from '#/lib/rom/api/native-types.ts'

const w = (id: string, label: string, conformTarget = '#Genesis9') => ({
  id,
  label,
  conformTarget,
})

describe('groomCandidates', () => {
  it('keeps top-level conforms only, drops body followers, dedupes, hair first', () => {
    const items = [
      w('crop-top', 'MM Crop Top'),
      w('cht-sevenly', 'CHT Sevenly Hair'),
      // Fitted to another wearable — rides along with its parent, no own entry.
      w('hair-base', 'Sevenly Hair Base', '#cht-sevenly'),
      // Body follower / gen assets are never candidates.
      w('gp', 'GoldenPalace_G9'),
      // Duplicate label collapses to one.
      w('crop-top-2', 'MM Crop Top'),
      w('lashes', 'Lashes Utilities Genesis 9 Root'),
    ]
    expect(groomCandidates(items)).toEqual([
      'CHT Sevenly Hair',
      'Lashes Utilities Genesis 9 Root',
      'MM Crop Top',
    ])
  })

  it('decodes percent-encoded conform refs when matching parents', () => {
    const items = [
      w('Black Tie Cap_1529', 'Black Tie Cap'),
      w('ponytail', 'Ponytail Braid', '#Black%20Tie%20Cap_1529'),
    ]
    // The braid conforms to the cap → only the cap is a candidate.
    expect(groomCandidates(items)).toEqual(['Black Tie Cap'])
  })
})

describe('detectedHairLabels', () => {
  it('is the hair-ish subset of the candidates — what creation pre-selects', () => {
    const items = [
      w('crop-top', 'MM Crop Top'),
      w('cht-sevenly', 'CHT Sevenly Hair'),
      w('brows', 'G9 Eyebrows Fiber Style 04 Thin'),
      w('lashes', 'Lashes Utilities Genesis 9 Root'),
    ]
    expect(detectedHairLabels(items)).toEqual([
      'CHT Sevenly Hair',
      'G9 Eyebrows Fiber Style 04 Thin',
      'Lashes Utilities Genesis 9 Root',
    ])
  })

  it('returns nothing for a hairless scene', () => {
    expect(detectedHairLabels([w('crop-top', 'MM Crop Top')])).toEqual([])
  })

  it('knows the HAIRSTYLE vocabulary — "Bixie Cut" is hair without the word "hair"', () => {
    // The real miss: OOT's Bixie Cut read as clothing, so the wand skipped it.
    const items = [
      w('bixie-main', 'Bixie Cut Main'),
      w('bixie-stray', 'Bixie Cut Stray'),
      w('updo', 'Nadira Updo'),
      w('crop-top', 'Invicta Couture LS Crop Top'),
    ]
    expect(detectedHairLabels(items)).toEqual(['Bixie Cut Main', 'Bixie Cut Stray', 'Nadira Updo'])
  })

  it('the risky words stay OUT — "cut"/"fringe"/"weave" alone are not hair', () => {
    // Measured against real product names: laser-cut outfits, fringe jackets,
    // fabric weaves. Only the style vocabulary (bixie/pixie/updo/…) counts.
    const items = [
      w('dress', 'Laser Cut Dress'),
      w('jacket', 'Fringe Jacket'),
      w('top', 'Basket Weave Top'),
    ]
    expect(detectedHairLabels(items)).toEqual([])
  })
})

// The rule every scene-linking path shares. It was inlined at creation and the
// first primary link, and MISSING from "Add scene" — so an added outfit scene
// (exactly the one that brings its own hair) started with an empty hair list
// and would have baked that hair into the FBX.
describe('seedSceneHair', () => {
  const scan = (items: Array<SceneWearable>, error = '') => ({ items, error })
  const hairy = [w('cht-sevenly', 'CHT Sevenly Hair'), w('crop-top', 'MM Crop Top')]

  it('mints a record carrying the detected hair', () => {
    const seeded = seedSceneHair('X:\\scenes\\Armor.duf', scan(hairy), [])
    expect(seeded).toHaveLength(1)
    expect(seeded?.[0].scenePath).toBe('X:\\scenes\\Armor.duf')
    expect(seeded?.[0].hair).toEqual([{ nodeLabel: 'CHT Sevenly Hair' }])
  })

  it('APPENDS — the other scenes keep their records', () => {
    const existing = seedSceneHair('X:\\scenes\\Primary.duf', scan(hairy), []) ?? []
    const seeded = seedSceneHair('X:\\scenes\\Armor.duf', scan(hairy), existing)
    expect(seeded?.map((o) => o.scenePath)).toEqual(['X:\\scenes\\Primary.duf', 'X:\\scenes\\Armor.duf'])
  })

  it('never clobbers a scene that already has a record', () => {
    // Re-adding a scene must not overwrite a hair list the user curated.
    const existing = seedSceneHair('X:\\scenes\\Armor.duf', scan(hairy), []) ?? []
    const curated = existing.map((o) => ({ ...o, hair: [] }))
    expect(seedSceneHair('X:\\scenes\\Armor.duf', scan(hairy), curated)).toBeNull()
  })

  it('matches an existing record separator/case-insensitively', () => {
    // The frontend mixes separators freely and Windows paths are
    // case-insensitive — the same scene stored the other way must still count
    // as "already has a record" (same normalization as the groom scene map).
    const existing = seedSceneHair('X:\\scenes\\Armor.duf', scan(hairy), []) ?? []
    expect(seedSceneHair('x:/Scenes/ARMOR.duf', scan(hairy), existing)).toBeNull()
  })

  it('does nothing for a hairless scene or an unreadable scan', () => {
    expect(seedSceneHair('X:\\a.duf', scan([w('crop-top', 'MM Crop Top')]), [])).toBeNull()
    // Browser mode / missing file: guessing from an empty read would silently
    // claim the scene has no hair.
    expect(seedSceneHair('X:\\a.duf', scan([], 'scene unreadable'), [])).toBeNull()
    expect(seedSceneHair('X:\\a.duf', scan(hairy, 'scene unreadable'), [])).toBeNull()
  })
})

describe('autoExportHair — the automatic per-scene "Export hair items"', () => {
  const hair = (...labels: Array<string>) => labels.map((nodeLabel) => ({ nodeLabel }))

  it('hair differing from the primary — even partly — arms the export', () => {
    expect(autoExportHair(hair('CHT Sevenly Hair'), hair('Nova Ponytail'))).toBe(true)
    // Partly different: one shared item, one own.
    expect(
      autoExportHair(hair('CHT Sevenly Hair'), hair('CHT Sevenly Hair', 'Nova Ponytail')),
    ).toBe(true)
    // A primary without hair still counts as "differs".
    expect(autoExportHair([], hair('Nova Ponytail'))).toBe(true)
  })

  it('a list fully matching the primary falls back to the default (absent)', () => {
    expect(autoExportHair(hair('CHT Sevenly Hair'), hair('CHT Sevenly Hair'))).toBeUndefined()
    // Order-independent — the same multiset compare as the override mark.
    expect(
      autoExportHair(hair('A', 'B'), hair('B', 'A')),
    ).toBeUndefined()
  })

  it('an emptied list falls back to the default — nothing to export', () => {
    expect(autoExportHair(hair('CHT Sevenly Hair'), [])).toBeUndefined()
    expect(autoExportHair([], [])).toBeUndefined()
  })

  it('blank labels are ignored on both sides', () => {
    expect(autoExportHair(hair('A', '  '), hair('A'))).toBeUndefined()
    expect(autoExportHair(hair('A'), hair('A', ' '))).toBeUndefined()
  })
})
