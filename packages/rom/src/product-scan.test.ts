import { describe, expect, it } from 'vitest'

import { mergeProductScans, parseProductScanCsv, type ProductScan } from './product-scan'

const HEADER =
  'row_type,name,sku,artist,version,product_type,match_method,technical_name,asset_type,source_file,usage,used_by'

describe('parseProductScanCsv', () => {
  it('parses product and asset rows, skipping the header', () => {
    const csv = [
      HEADER,
      'product,Golden Palace,2254-1,Meipe,1.0,Anatomy,SKU Match,,,,Genitalia,GoldenPalace_G9',
      'asset,Some Prop,,Luthbellina,2.3,,,someProp_1234,Node,/data/Vendor/Some Prop/someProp.dsf,,',
    ].join('\n')
    const scan = parseProductScanCsv(csv)
    expect(scan.products).toEqual([
      {
        name: 'Golden Palace',
        sku: '2254-1',
        artist: 'Meipe',
        version: '1.0',
        productType: 'Anatomy',
        matchMethod: 'SKU Match',
        usage: 'Genitalia',
        usedBy: 'GoldenPalace_G9',
        scenes: [],
      },
    ])
    expect(scan.unmatched).toEqual([
      {
        name: 'Some Prop',
        technicalName: 'someProp_1234',
        assetType: 'Node',
        sourceFile: '/data/Vendor/Some Prop/someProp.dsf',
        artist: 'Luthbellina',
        version: '2.3',
        scenes: [],
      },
    ])
  })

  it('reads the scene meta row (name + path)', () => {
    const csv = [
      HEADER,
      'scene,KiraSummertide_G9_GP,X:/_3d/Kira_G9/daz3d/KiraSummertide_G9_GP.duf,,,,,,,,,',
      'product,X,,,,,,,',
    ].join('\n')
    const scan = parseProductScanCsv(csv)
    expect(scan.sceneName).toBe('KiraSummertide_G9_GP')
    expect(scan.scenePath).toBe('X:/_3d/Kira_G9/daz3d/KiraSummertide_G9_GP.duf')
    expect(scan.products.map((p) => p.name)).toEqual(['X'])
  })

  it('defaults the scene to empty when there is no scene row', () => {
    const scan = parseProductScanCsv(`${HEADER}\nproduct,X,,,,,,,`)
    expect(scan.sceneName).toBe('')
    expect(scan.scenePath).toBe('')
  })

  it('handles quoted fields with commas and doubled quotes', () => {
    const csv = [
      HEADER,
      'product,"Bits, Bobs & ""More""",1509-1,"Smith, J.",2.3,Prop,Keyword Match,,',
    ].join('\n')
    const scan = parseProductScanCsv(csv)
    expect(scan.products[0].name).toBe('Bits, Bobs & "More"')
    expect(scan.products[0].artist).toBe('Smith, J.')
  })

  it('handles an embedded newline inside a quoted field', () => {
    const csv = `${HEADER}\nproduct,"Line one\nLine two",,,,,,,\n`
    const scan = parseProductScanCsv(csv)
    expect(scan.products).toHaveLength(1)
    expect(scan.products[0].name).toBe('Line one\nLine two')
  })

  it('tolerates CRLF line endings and a trailing newline', () => {
    const csv = `${HEADER}\r\nproduct,Dicktator,1234-1,Meipe,3.0,Anatomy,Third-Party Match,,\r\n`
    const scan = parseProductScanCsv(csv)
    expect(scan.products).toHaveLength(1)
    expect(scan.products[0].name).toBe('Dicktator')
  })

  it('ignores blank lines and unknown row types', () => {
    const csv = [HEADER, '', 'note,whatever,,,,,,,', 'product,X,,,,,,,'].join('\n')
    const scan = parseProductScanCsv(csv)
    expect(scan.products.map((p) => p.name)).toEqual(['X'])
    expect(scan.unmatched).toEqual([])
  })

  it('defaults trailing columns to empty when missing (older row)', () => {
    const csv = `${HEADER}\nasset,Bare Prop,,,,,,bareProp,Node`
    expect(parseProductScanCsv(csv).unmatched).toEqual([
      {
        name: 'Bare Prop',
        technicalName: 'bareProp',
        assetType: 'Node',
        sourceFile: '',
        artist: '',
        version: '',
        scenes: [],
      },
    ])
  })

  it('strips a leading BOM', () => {
    const csv = `﻿${HEADER}\nproduct,Y,,,,,,,`
    expect(parseProductScanCsv(csv).products.map((p) => p.name)).toEqual(['Y'])
  })

  it('returns empty arrays for a header-only or empty file', () => {
    expect(parseProductScanCsv(HEADER)).toEqual({
      sceneName: '',
      scenePath: '',
      products: [],
      unmatched: [],
    })
    expect(parseProductScanCsv('')).toEqual({
      sceneName: '',
      scenePath: '',
      products: [],
      unmatched: [],
    })
  })
})

describe('mergeProductScans', () => {
  const scan = (sceneName: string, productNames: Array<string>, unmatched: Array<string>): ProductScan => ({
    sceneName,
    scenePath: `X:/${sceneName}.duf`,
    products: productNames.map((name) => ({
      name,
      sku: name === 'Essentials' ? '111-1' : '',
      artist: '',
      version: '',
      productType: '',
      matchMethod: '',
      usage: '',
      usedBy: '',
      scenes: [],
    })),
    unmatched: unmatched.map((name) => ({
      name,
      technicalName: name,
      assetType: 'Node',
      sourceFile: '',
      artist: '',
      version: '',
      scenes: [],
    })),
  })

  it('unions products/assets across scenes, tagging each with the scenes it appears in', () => {
    const merged = mergeProductScans([
      scan('Default', ['Essentials', 'SU Yoga'], ['Zipper']),
      scan('Summertide', ['Essentials', 'Summertide Top'], ['Zipper', 'Frangipani']),
    ])
    expect(merged.scenes).toEqual(['Default', 'Summertide'])

    const byName = Object.fromEntries(merged.products.map((p) => [p.name, p.scenes]))
    expect(byName['Essentials']).toEqual(['Default', 'Summertide']) // shared → both
    expect(byName['SU Yoga']).toEqual(['Default'])
    expect(byName['Summertide Top']).toEqual(['Summertide'])

    const unmatchedByName = Object.fromEntries(merged.unmatched.map((a) => [a.name, a.scenes]))
    expect(unmatchedByName['Zipper']).toEqual(['Default', 'Summertide'])
    expect(unmatchedByName['Frangipani']).toEqual(['Summertide'])
  })

  it('sorts products and unmatched assets alphabetically (case-insensitive)', () => {
    const merged = mergeProductScans([
      scan('Default', ['Zebra', 'apple', 'Mango'], ['zeta', 'Alpha']),
    ])
    expect(merged.products.map((p) => p.name)).toEqual(['apple', 'Mango', 'Zebra'])
    expect(merged.unmatched.map((a) => a.name)).toEqual(['Alpha', 'zeta'])
  })

  it('labels a scan of an unsaved scene', () => {
    const merged = mergeProductScans([scan('', ['Essentials'], [])])
    expect(merged.scenes).toEqual(['(unsaved scene)'])
    expect(merged.products[0].scenes).toEqual(['(unsaved scene)'])
  })

  it('unions usedBy/usage of a shared product across scenes', () => {
    const one: ProductScan = {
      sceneName: 'A',
      scenePath: '',
      products: [makeProduct({ usage: 'Morph', usedBy: 'X (Morph)' })],
      unmatched: [],
    }
    const two: ProductScan = {
      sceneName: 'B',
      scenePath: '',
      products: [makeProduct({ usage: 'Clothing', usedBy: 'X (Morph); Y (Node)' })],
      unmatched: [],
    }
    const merged = mergeProductScans([one, two])
    expect(merged.products).toHaveLength(1)
    expect(merged.products[0].usedBy).toBe('X (Morph); Y (Node)')
    expect(merged.products[0].usage).toBe('Morph; Clothing')
    expect(merged.products[0].scenes).toEqual(['A', 'B'])
  })
})

function makeProduct(over: Partial<ProductScan['products'][number]>): ProductScan['products'][number] {
  return {
    name: 'Shared',
    sku: '999-1',
    artist: '',
    version: '',
    productType: '',
    matchMethod: '',
    usage: '',
    usedBy: '',
    scenes: [],
    ...over,
  }
}
