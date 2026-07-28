import { describe, expect, it } from 'vitest'

import { detectedHairLabels, groomCandidates } from './groom-detect.ts'

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
})
