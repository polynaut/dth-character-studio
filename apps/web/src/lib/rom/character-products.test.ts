import { describe, expect, it } from 'vitest'

import {
  characterProductsJson,
  emptyCharacterProducts,
  mergedProducts,
  parseCharacterProductsText,
  withScans,
  withoutUnlinkedScenes,
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

  it('a path-keyed scan replaces a path-less entry with the same scene NAME', () => {
    // The carry rebuilds pre-v30 scans with '' paths (a merged definition kept
    // only scene names); a fresh Daz scan always carries the full path. Without
    // the name fallback the carried entry could never be replaced — every
    // re-scan would append a duplicate and the stale products would sit in the
    // merged view forever.
    const carried = withScans(emptyCharacterProducts(), [scan('Default', ['Old Thing'])], AT)
    const after = withScans(
      carried,
      [scan('Default', ['New Thing'], 'D:/p/Default.duf')],
      '2026-08-08T10:00:00.000Z',
    )
    expect(after.scans).toHaveLength(1)
    expect(after.scans[0].scenePath).toBe('D:/p/Default.duf')
    expect(after.scans[0].products.map((p) => p.name)).toEqual(['New Thing'])
  })

  it('the name fallback never bridges two path-keyed entries', () => {
    // Two scenes sharing a basename in different folders are different scenes;
    // only a path-LESS side may match by name.
    const before = withScans(emptyCharacterProducts(), [scan('Kira', ['A'], 'D:/p/one/Kira.duf')], AT)
    const after = withScans(before, [scan('Kira', ['B'], 'D:/p/two/Kira.duf')], AT)
    expect(after.scans).toHaveLength(2)
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

describe('withoutUnlinkedScenes', () => {
  const linked = ['D:/p/Kira/daz3d/Kira.duf', 'D:/p/Kira/daz3d/Beach.duf']

  it('drops a path-keyed entry whose scene is no longer linked', () => {
    const store = withScans(
      emptyCharacterProducts(),
      [scan('Kira', ['A'], 'D:/p/Kira/daz3d/Kira.duf'), scan('Old', ['B'], 'D:/p/Kira/daz3d/Old.duf')],
      AT,
    )
    const pruned = withoutUnlinkedScenes(store, linked)
    expect(pruned.scans.map((s) => s.sceneName)).toEqual(['Kira'])
  })

  it('keeps path-less entries — the unsaved bucket and carried pre-v30 scans are unverifiable', () => {
    const store = withScans(
      emptyCharacterProducts(),
      [scan('SomethingCarried', ['A']), scan('', ['B'])],
      AT,
    )
    expect(withoutUnlinkedScenes(store, linked)).toBe(store) // untouched → same object
  })

  it('matches linked paths case-insensitively and across slash styles', () => {
    const store = withScans(
      emptyCharacterProducts(),
      [scan('Kira', ['A'], 'd:\\p\\kira\\daz3d\\KIRA.duf')],
      AT,
    )
    expect(withoutUnlinkedScenes(store, linked)).toBe(store)
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
