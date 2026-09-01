import { describe, expect, it } from 'vitest'

import {
  buildProductSharePayload,
  contentRelativePath,
  payloadHash,
} from './product-share.ts'

import type { MergedProductScan, ProductRecord, UnmatchedAsset } from '@dth/rom'

// The payload builder IS the privacy contract: what these tests pin is not
// formatting but what may leave the machine — product facts in, everything
// user-shaped out. The Worker (services/products-ingest) re-checks the same
// promises server-side; its validator and this builder must not drift.

const product = (over: Partial<ProductRecord> = {}): ProductRecord => ({
  name: 'Adventure Clothes',
  sku: '',
  artist: 'Luthbellina',
  version: '1.2',
  productType: 'Clothing',
  matchMethod: 'Third-Party Match',
  usage: 'Clothing',
  usedBy: 'AC Gloves; AC Boots',
  scenes: ['KiraDefault_G9_GP'],
  ...over,
})

const unmatched = (over: Partial<UnmatchedAsset> = {}): UnmatchedAsset => ({
  name: 'Frangipani Hair',
  technicalName: 'FrangipaniHair',
  assetType: 'Node',
  sourceFile: 'D:/Daz/My DAZ 3D Library/data/Vendor/Frangipani/hair.dsf',
  artist: 'SomeVendor',
  version: '1.0',
  scenes: ['KiraDefault_G9_GP'],
  ...over,
})

const scan = (over: Partial<MergedProductScan> = {}): MergedProductScan => ({
  scenes: ['KiraDefault_G9_GP'],
  products: [],
  unmatched: [],
  ...over,
})

describe('contentRelativePath', () => {
  it('cuts an absolute library path at the content tree, lowercased', () => {
    expect(contentRelativePath('D:\\Daz\\My DAZ 3D Library\\data\\Vendor\\P\\x.dsf')).toBe(
      'data/vendor/p/x.dsf',
    )
    expect(contentRelativePath('E:/lib/Runtime/Textures/V/skin.jpg')).toBe(
      'runtime/textures/v/skin.jpg',
    )
    // Already-relative stays as it is.
    expect(contentRelativePath('data/Vendor/P/x.dsf')).toBe('data/vendor/p/x.dsf')
  })

  it("a path that doesn't reduce to the content tree becomes '' — never leaves absolute", () => {
    expect(contentRelativePath('C:/Users/remo/Desktop/loose.duf')).toBe('')
    expect(contentRelativePath('')).toBe('')
  })
})

describe('buildProductSharePayload', () => {
  it('carries product facts and STRIPS the user-shaped fields', () => {
    const payload = buildProductSharePayload('0.93.0', scan({ products: [product()] }))
    expect(payload).not.toBeNull()
    expect(payload?.products).toEqual([
      {
        name: 'Adventure Clothes',
        sku: '',
        artist: 'Luthbellina',
        version: '1.2',
        productType: 'Clothing',
        matchMethod: 'Third-Party Match',
      },
    ])
    // The whole payload — not just the products array — must be free of scene
    // names and usage columns; a new field sneaking through fails here.
    const text = JSON.stringify(payload)
    expect(text).not.toContain('KiraDefault')
    expect(text).not.toContain('usedBy')
    expect(text).not.toContain('AC Gloves')
  })

  it('relativizes unmatched source files and keeps their artist/version provenance', () => {
    const payload = buildProductSharePayload('0.93.0', scan({ unmatched: [unmatched()] }))
    expect(payload?.unmatched).toEqual([
      {
        name: 'Frangipani Hair',
        technicalName: 'FrangipaniHair',
        assetType: 'Node',
        sourceFile: 'data/vendor/frangipani/hair.dsf',
        artist: 'SomeVendor',
        version: '1.0',
      },
    ])
  })

  it('an empty scan builds NO payload — an empty row must not reach the server', () => {
    expect(buildProductSharePayload('0.93.0', scan())).toBeNull()
    // Nameless entries don't count as content either.
    expect(
      buildProductSharePayload('0.93.0', scan({ products: [product({ name: '  ' })] })),
    ).toBeNull()
  })

  it('dedupes and sorts, so scan order cannot change the payload (hash-stable)', () => {
    const a = buildProductSharePayload(
      '0.93.0',
      scan({
        products: [product({ name: 'Zebra Outfit' }), product(), product()],
        unmatched: [unmatched(), unmatched()],
      }),
    )
    const b = buildProductSharePayload(
      '0.93.0',
      scan({
        products: [product(), product({ name: 'Zebra Outfit' })],
        unmatched: [unmatched()],
      }),
    )
    expect(a).toEqual(b)
    expect(payloadHash(a!)).toBe(payloadHash(b!))
    expect(a?.products.map((p) => p.name)).toEqual(['Adventure Clothes', 'Zebra Outfit'])
  })

  it('different content hashes differently', () => {
    const a = buildProductSharePayload('0.93.0', scan({ products: [product()] }))
    const b = buildProductSharePayload(
      '0.93.0',
      scan({ products: [product({ version: '1.3' })] }),
    )
    expect(payloadHash(a!)).not.toBe(payloadHash(b!))
  })
})
