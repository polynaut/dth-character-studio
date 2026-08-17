import { describe, expect, it } from 'vitest'

import { LANDSCAPE_FIXED_LIFT, SCENE_TILE_SIZES } from '#/components/portrait.tsx'

/**
 * Every LANDSCAPE crop of a Daz tip must land the face in the same painted place,
 * whatever shape its frame is — because where the face sits in the render has
 * nothing to do with the tile. Three variants exist and each expresses the lift
 * differently: the scene tiles as `-50%` plus a per-size pixel correction (the
 * correction cancels the differing half-heights), and the project overview's
 * list-view tile as a flat pixel offset.
 *
 * That is the whole reason the pre-G9 numbers are derivable rather than each
 * needing its own measurement: `md` was measured against a real G8.1 tip at
 * `+12px`, and everything else follows from the shared painted offset. It also
 * pre-dates the change — `-translate-y-[14px]` on the list view had already been
 * tuned by hand to exactly the −14px the scene tiles resolve to, independently.
 *
 * Worth a test rather than a comment because the smoke suite can only cover the
 * variants a page actually renders (the character page renders `md` alone), so
 * the derived values — `sm`'s `+8px`, the list view's `−6px` — are precisely the
 * ones nothing else checks. Getting a pair wrong reads fine in the source and
 * clips the head on screen.
 */

/** The `-50%` resolves against the CONTENT box, and every frame is `border-2`. */
const BORDER_PX = 4
const FRAME_HEIGHT_PX: Record<string, number> = { 'h-8': 32, 'h-10': 40 }

/** Painted lift for a scene tile: `-50%` of its content box, plus its correction. */
function tileLift(frame: string, lift: string): number {
  const outer = FRAME_HEIGHT_PX[frame.split(' ')[0]!]
  if (outer == null) throw new Error(`unmapped frame height: ${frame}`)
  const content = outer - BORDER_PX
  // Either `-translate-y-1/2` (a bare -50%) or `translate-y-[calc(-50%_+_Npx)]`.
  if (lift === '-translate-y-1/2') return -0.5 * content
  const px = /calc\(-50%_\+_(\d+)px\)/.exec(lift)?.[1]
  if (px == null) throw new Error(`unparsed lift: ${lift}`)
  return -0.5 * content + Number(px)
}

/** Painted lift for a fixed-pixel frame: the number IS the lift. */
function fixedLift(lift: string): number {
  const px = /^-translate-y-\[(\d+)px\]$/.exec(lift)?.[1]
  if (px == null) throw new Error(`unparsed lift: ${lift}`)
  return -Number(px)
}

/** What every landscape variant must land on, per framing. */
const PAINTED = { g9: -14, preG9: -6 } as const

describe('landscape tip framings', () => {
  it('every scene-tile size lands its framing’s painted lift', () => {
    const sizes = Object.values(SCENE_TILE_SIZES)
    expect(sizes.map((s) => tileLift(s.frame, s.g9))).toEqual(sizes.map(() => PAINTED.g9))
    expect(sizes.map((s) => tileLift(s.frame, s.preG9))).toEqual(sizes.map(() => PAINTED.preG9))
  })

  it('the fixed-pixel frame lands the SAME lifts as the scene tiles', () => {
    // The list-view tile is a different shape expressed a different way; if it
    // ever drifts from the tiles, one of the two is cropping to a face that
    // isn't there.
    expect(fixedLift(LANDSCAPE_FIXED_LIFT.g9)).toBe(PAINTED.g9)
    expect(fixedLift(LANDSCAPE_FIXED_LIFT.preG9)).toBe(PAINTED.preG9)
  })

  it('covers every size in both framings', () => {
    // A size added with only one column filled in would otherwise pass above by
    // being absent from the comparison it breaks.
    for (const [name, size] of Object.entries(SCENE_TILE_SIZES)) {
      expect(size.g9, name).toBeTruthy()
      expect(size.preG9, name).toBeTruthy()
      expect(FRAME_HEIGHT_PX[size.frame.split(' ')[0]!], name).toBeDefined()
    }
  })
})
