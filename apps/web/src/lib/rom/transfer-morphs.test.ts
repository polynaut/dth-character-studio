import { describe, expect, it } from 'vitest'

import { matchingTransferDials, normalizeTransferEntry } from './transfer-morphs.ts'

import type { MorphIndexEntry } from './api/characters'

// The matching rule lives on BOTH sides of the install boundary — this TS
// preview and the baked Prepare_For_Transfer.dsa's shouldZero — so these cases
// pin exactly the promises the script's comments (and the Settings tab's help
// text) make. A change here without the same change in the .dsa is drift.

const dial = (name: string, label: string): MorphIndexEntry => ({
  node: 'Genesis8_1Female',
  nodeLabel: 'G8.1F',
  name,
  label,
})

const INDEX = [
  dial('PBMBreastsSize', 'Breasts Size'),
  dial('PBMNipples', 'Nipples'),
  dial('PBMNipplesTipAdjust', 'Nipples Tip Adjust'),
  dial('PBMAreolaeDiameter', 'Areolae Diameter'),
  dial('body_ctrl_BreastsUpDown', 'Breasts Up-Down'),
  dial('CTRLVoluptuous', 'Voluptuous'),
  dial('PBMGluteSize', 'Glute Size'),
]

describe('the transfer-morph matching preview', () => {
  it('normalizes case, spaces, dashes and underscores away', () => {
    expect(normalizeTransferEntry('Breasts Up-Down')).toBe('breastsupdown')
    expect(normalizeTransferEntry('body_ctrl_BreastsUpDown')).toBe('bodyctrlbreastsupdown')
  })

  it('an entry with spaces matches the prefixed internal name — the help text’s promise', () => {
    expect(matchingTransferDials('Breasts Size', INDEX).map((m) => m.name)).toEqual([
      'PBMBreastsSize',
    ])
  })

  it('a singular family entry covers the whole family', () => {
    expect(matchingTransferDials('Nipple', INDEX).map((m) => m.label)).toEqual([
      'Nipples',
      'Nipples Tip Adjust',
    ])
    // …and the reason the default is "Areola", not "Areolae": the singular
    // form contains-matches both spellings.
    expect(matchingTransferDials('Areola', INDEX)).toHaveLength(1)
  })

  it('dash and case differences do not decide a match', () => {
    expect(matchingTransferDials('breasts updown', INDEX).map((m) => m.name)).toEqual([
      'body_ctrl_BreastsUpDown',
    ])
  })

  it('an unrelated or empty entry matches nothing', () => {
    expect(matchingTransferDials('Torso Length', INDEX)).toEqual([])
    expect(matchingTransferDials('   ', INDEX)).toEqual([])
  })
})
