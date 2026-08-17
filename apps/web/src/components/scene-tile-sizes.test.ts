import { describe, expect, it } from 'vitest'

import { SCENE_TILE_SIZES } from '#/components/portrait.tsx'

/**
 * The landscape scene tiles carry a per-SIZE pixel correction on top of a `-50%`
 * lift, and those corrections are only derivable because of one invariant: within
 * a framing, every size must land the SAME painted lift. Where the face sits in a
 * Daz tip has nothing to do with how big the tile is — the px term exists purely
 * to cancel the differing `-50%` baselines.
 *
 * Worth a test rather than a comment because the smoke suite can only assert the
 * sizes a page actually renders, and the character page renders `md` alone. `sm`'s
 * pre-G9 `+8px` was DERIVED from `md`'s measured `+12px` through this invariant
 * and is otherwise unexercised — exactly the value most likely to be a typo.
 *
 * Getting a pair wrong is the bug SCENE_TILE_SIZES' own doc calls out: it reads
 * fine in the source and clips the head on screen.
 */

/** The `-50%` resolves against the CONTENT box, and the frame is `border-2`. */
const BORDER_PX = 4
const FRAME_HEIGHT_PX: Record<string, number> = { 'h-8': 32, 'h-10': 40 }

/** Where the image's top edge lands, in px, for one size/framing pair. */
function paintedLift(frame: string, lift: string): number {
  const outer = FRAME_HEIGHT_PX[frame.split(' ')[0]!]
  if (outer == null) throw new Error(`unmapped frame height: ${frame}`)
  const content = outer - BORDER_PX
  // Either `-translate-y-1/2` (a bare -50%) or `translate-y-[calc(-50%_+_Npx)]`.
  if (lift === '-translate-y-1/2') return -0.5 * content
  const px = /calc\(-50%_\+_(\d+)px\)/.exec(lift)?.[1]
  if (px == null) throw new Error(`unparsed lift: ${lift}`)
  return -0.5 * content + Number(px)
}

describe('SCENE_TILE_SIZES', () => {
  it('lands ONE painted lift per framing, whatever the tile size', () => {
    const sizes = Object.values(SCENE_TILE_SIZES)
    // -14px: -50% of sm's 28px content box; -50% of md's 36 plus its +4.
    expect(sizes.map((s) => paintedLift(s.frame, s.g9))).toEqual(sizes.map(() => -14))
    // -6px, anchored on the +12 measured against a real G8.1 tip at `md`.
    // sm's +8 is derived from this number and has no other check.
    expect(sizes.map((s) => paintedLift(s.frame, s.preG9))).toEqual(sizes.map(() => -6))
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
