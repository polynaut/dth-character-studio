import { describe, expect, it } from 'vitest'

import {
  characterProductsJson,
  emptyCharacterProducts,
  mergedProducts,
  parseCharacterProductsText,
  withScans,
} from './character-products.ts'

import type { ProductScan } from '@dth/rom'

// The rule that decides what a pickup does to what is already stored. It matters
// because a scan run covers whichever scenes were opened — often exactly one —
// and the obvious "overwrite the file with what we just found" would silently
// throw away every other scene's products.

function scan(sceneName: string, products: Array<string>, scenePath = ''): ProductScan {
  return {
    sceneName,
    scenePath,
    products: products.map((name) => ({
      name,
      sku: '',
      artist: '',
      version: '',
      productType: '',
      matchMethod: 'File Match',
      usage: '',
      usedBy: '',
      scenes: [],
    })),
    unmatched: [],
  }
}

const AT = '2026-08-07T10:00:00.000Z'

describe('withScans', () => {
  it('adds a scene the store has never seen', () => {
    const store = withScans(emptyCharacterProducts(), [scan('Default', ['Golden Palace'])], AT)
    expect(store.scans).toHaveLength(1)
    expect(store.scans[0].sceneName).toBe('Default')
    expect(store.scannedAt).toBe(AT)
    expect(store.scans[0].scannedAt).toBe(AT)
  })

  it('replaces ONLY the scene it carries, keeping the others', () => {
    const before = withScans(
      emptyCharacterProducts(),
      [scan('Default', ['Golden Palace']), scan('Summertide', ['Beachwear'])],
      AT,
    )
    // A re-scan of one scene, finding something different this time.
    const after = withScans(before, [scan('Default', ['Dicktator'])], '2026-08-08T10:00:00.000Z')

    expect(after.scans.map((s) => s.sceneName)).toEqual(['Default', 'Summertide'])
    expect(after.scans[0].products.map((p) => p.name)).toEqual(['Dicktator'])
    // Untouched — including its older pickup stamp.
    expect(after.scans[1].products.map((p) => p.name)).toEqual(['Beachwear'])
    expect(after.scans[1].scannedAt).toBe(AT)
  })

  it('matches a scene by PATH when it has one, so two scenes can share a basename', () => {
    const before = withScans(
      emptyCharacterProducts(),
      [scan('Kira', ['A'], 'D:/p/one/Kira.duf'), scan('Kira', ['B'], 'D:/p/two/Kira.duf')],
      AT,
    )
    const after = withScans(before, [scan('Kira', ['C'], 'D:/p/two/Kira.duf')], AT)

    expect(after.scans).toHaveLength(2)
    expect(after.scans[0].products.map((p) => p.name)).toEqual(['A'])
    expect(after.scans[1].products.map((p) => p.name)).toEqual(['C'])
  })

  it('is a no-op for an empty pickup — an empty drop folder must not clear the store', () => {
    const before = withScans(emptyCharacterProducts(), [scan('Default', ['Golden Palace'])], AT)
    expect(withScans(before, [], '2026-09-09T00:00:00.000Z')).toBe(before)
  })

  it('merges every stored scene for display', () => {
    const store = withScans(
      emptyCharacterProducts(),
      [scan('Default', ['Golden Palace']), scan('Summertide', ['Golden Palace', 'Beachwear'])],
      AT,
    )
    const merged = mergedProducts(store)
    expect(merged.scenes).toEqual(['Default', 'Summertide'])
    expect(merged.products.map((p) => p.name)).toEqual(['Beachwear', 'Golden Palace'])
    // The shared product is attributed to both scenes it was found in.
    expect(merged.products.find((p) => p.name === 'Golden Palace')?.scenes).toEqual([
      'Default',
      'Summertide',
    ])
  })
})

describe('parseCharacterProductsText', () => {
  it('round-trips what it writes', () => {
    const store = withScans(emptyCharacterProducts(), [scan('Default', ['Golden Palace'])], AT)
    expect(parseCharacterProductsText(characterProductsJson(store))).toEqual(store)
  })

  it('reads a torn or hand-mangled file as EMPTY rather than throwing', () => {
    // The results are re-derivable by scanning again, so failing loud here would
    // only break the page that shows them.
    expect(parseCharacterProductsText('{ "scans": [').scans).toEqual([])
    expect(parseCharacterProductsText('').scans).toEqual([])
    expect(parseCharacterProductsText('null').scans).toEqual([])
  })
})
