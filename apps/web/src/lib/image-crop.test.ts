import { describe, expect, it } from 'vitest'

import {
  AVATAR_PORTRAIT_ASPECT,
  avatarOutputSize,
  clampCrop,
  cropSizeForZoomFraction,
  initialCrop,
  MAX_AVATAR_SOURCE_PX,
  MIN_AVATAR_SOURCE_PX,
  panCrop,
  portraitBarFraction,
  validateAvatarSource,
  zoomCrop,
  zoomFraction,
} from './image-crop.ts'

describe('validateAvatarSource', () => {
  it('accepts anything within 256..2048 on both sides, any aspect', () => {
    expect(validateAvatarSource(256, 256)).toBeNull()
    expect(validateAvatarSource(2048, 2048)).toBeNull()
    expect(validateAvatarSource(2048, 300)).toBeNull() // wide, still valid
    expect(validateAvatarSource(300, 2048)).toBeNull() // tall, still valid
    expect(validateAvatarSource(896, 1192)).toBeNull() // the real case that was wrongly rejected
  })

  it('rejects too small on either side with the dimensions', () => {
    expect(validateAvatarSource(255, 800)).toMatch(/too small.*255×800/)
    expect(validateAvatarSource(800, 100)).toMatch(/too small/)
  })

  it('rejects too large on either side', () => {
    expect(validateAvatarSource(2049, 512)).toMatch(/too large.*2049×512/)
    expect(validateAvatarSource(512, 3000)).toMatch(/too large/)
  })
})

describe('initialCrop', () => {
  it('is the largest centered square', () => {
    expect(initialCrop(1000, 600)).toEqual({ x: 200, y: 0, size: 600 })
    expect(initialCrop(400, 900)).toEqual({ x: 0, y: 250, size: 400 })
    expect(initialCrop(500, 500)).toEqual({ x: 0, y: 0, size: 500 })
  })
})

describe('clampCrop', () => {
  it('keeps size within [min(256,maxSquare), maxSquare] and the rect inside', () => {
    // Zoom past the min → clamped to 256.
    expect(clampCrop({ x: 0, y: 0, size: 100 }, 800, 600)).toMatchObject({ size: 256 })
    // Zoom past the largest square → clamped to 600.
    expect(clampCrop({ x: 0, y: 0, size: 9999 }, 800, 600)).toMatchObject({ size: 600 })
    // Position pushed out of bounds → slid back in.
    const c = clampCrop({ x: -50, y: 999, size: 400 }, 800, 600)
    expect(c.x).toBe(0)
    expect(c.y).toBe(200) // 600 - 400
  })

  it('never demands a square bigger than the image (tiny-but-valid source)', () => {
    // A 256×256 source: min square == max square == 256, no room to move.
    const c = clampCrop({ x: 5, y: 5, size: 256 }, 256, 256)
    expect(c).toEqual({ x: 0, y: 0, size: 256 })
  })
})

describe('panCrop', () => {
  it('moves the crop opposite the drag, scaled by zoom, and clamps at edges', () => {
    // View 288px, crop 576px source → scale 2: a 10px drag right moves the
    // crop 20px left (revealing the image's left).
    const start = { x: 100, y: 100, size: 576 }
    const panned = panCrop(start, 10, 0, 288, 2000, 2000)
    expect(panned.x).toBe(80)
    // Dragging further than the left edge clamps at 0.
    expect(panCrop(start, 1000, 0, 288, 2000, 2000).x).toBe(0)
  })
})

describe('zoomCrop', () => {
  it('zooms about the center and clamps', () => {
    const start = { x: 100, y: 100, size: 800 } // center (500,500)
    const zoomed = zoomCrop(start, 2, 2000, 2000) // size 400, center preserved
    expect(zoomed).toEqual({ x: 300, y: 300, size: 400 })
  })

  it('never zooms in past the 256px floor', () => {
    const start = { x: 0, y: 0, size: 400 } // center (200,200)
    const zoomed = zoomCrop(start, 4, 2000, 2000) // would be size 100 → clamped 256
    expect(zoomed.size).toBe(MIN_AVATAR_SOURCE_PX)
  })

  it('slides back inside when zooming out at an edge', () => {
    const atEdge = { x: 0, y: 0, size: 400 }
    const out = zoomCrop(atEdge, 0.5, 1000, 1000) // size 800, center was (200,200)
    // Center would be (200,200) → x=-200, clamped to 0.
    expect(out).toEqual({ x: 0, y: 0, size: 800 })
  })
})

describe('avatarOutputSize', () => {
  it('is 512 only when the crop region is at least 512', () => {
    expect(avatarOutputSize(512)).toBe(512)
    expect(avatarOutputSize(700)).toBe(512)
    expect(avatarOutputSize(511)).toBe(256)
    expect(avatarOutputSize(256)).toBe(256)
  })
})

describe('zoomFraction round-trips with cropSizeForZoomFraction', () => {
  it('maps 0 → largest square, 1 → 256', () => {
    const w = 1000
    const h = 800 // max square 800
    expect(cropSizeForZoomFraction(0, w, h)).toBe(800)
    expect(cropSizeForZoomFraction(1, w, h)).toBe(MIN_AVATAR_SOURCE_PX)
    expect(zoomFraction(800, w, h)).toBe(0)
    expect(zoomFraction(256, w, h)).toBe(1)
    // Round-trip an interior point.
    const size = cropSizeForZoomFraction(0.5, w, h)
    expect(zoomFraction(size, w, h)).toBeCloseTo(0.5)
  })

  it('collapses to 0 when the largest square is already the minimum', () => {
    expect(zoomFraction(256, 256, 256)).toBe(0)
  })
})

describe('bounds constants', () => {
  it('match the spec', () => {
    expect(MIN_AVATAR_SOURCE_PX).toBe(256)
    expect(MAX_AVATAR_SOURCE_PX).toBe(2048)
  })
})

describe('portraitBarFraction', () => {
  it('is half the width cropped by the 3:4 portrait frame, per side', () => {
    // A centred 3:4 strip survives, so each side bar covers (1 - 3/4)/2 = 1/8.
    expect(portraitBarFraction()).toBeCloseTo(0.125)
    expect(portraitBarFraction()).toBeCloseTo((1 - AVATAR_PORTRAIT_ASPECT) / 2)
    // Two bars + the visible strip cover the whole square.
    expect(2 * portraitBarFraction() + AVATAR_PORTRAIT_ASPECT).toBeCloseTo(1)
  })
})
