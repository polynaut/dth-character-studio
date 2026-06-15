import { describe, expect, it } from 'vitest'

import { canonicalImage, isExternalImage } from './image'

describe('isExternalImage', () => {
  it('treats remote and data URLs as external', () => {
    expect(isExternalImage('https://example.com/a.png')).toBe(true)
    expect(isExternalImage('http://example.com/a.png')).toBe(true)
    expect(isExternalImage('data:image/png;base64,AAAA')).toBe(true)
  })

  it('does not treat the asset protocol or bare filenames as external', () => {
    expect(isExternalImage('http://asset.localhost/C%3A%5Cx%5Cy.png')).toBe(false)
    expect(isExternalImage('feb5c30e.png')).toBe(false)
    expect(isExternalImage('')).toBe(false)
  })
})

describe('canonicalImage', () => {
  it('keeps empty / non-string values empty', () => {
    expect(canonicalImage('')).toBe('')
    expect(canonicalImage(undefined)).toBe('')
    expect(canonicalImage(null)).toBe('')
    expect(canonicalImage(42)).toBe('')
  })

  it('keeps genuine remote and data URLs verbatim', () => {
    expect(canonicalImage('https://example.com/a.png?size=2')).toBe(
      'https://example.com/a.png?size=2',
    )
    expect(canonicalImage('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  })

  it('already-canonical filenames pass through unchanged', () => {
    expect(canonicalImage('feb5c30e-2e1f.png')).toBe('feb5c30e-2e1f.png')
  })

  it('collapses asset-protocol URLs (with cache-buster) to the basename', () => {
    // Windows convertFileSrc form: backslash-separated, percent-encoded, ?v=…
    const assetUrl = 'http://asset.localhost/C%3A%5CUsers%5Cme%5Cimages%5Cfeb5c30e.png?v=123'
    expect(canonicalImage(assetUrl)).toBe('feb5c30e.png')
  })

  it('collapses legacy Electron routes and absolute paths to the basename', () => {
    expect(canonicalImage('/api/character-images/feb5c30e.png?v=999')).toBe('feb5c30e.png')
    expect(canonicalImage('/images/electra.png')).toBe('electra.png')
    expect(canonicalImage('C:\\Users\\me\\images\\electra.png')).toBe('electra.png')
  })
})
