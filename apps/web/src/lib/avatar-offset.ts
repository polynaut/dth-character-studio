import type { CSSProperties } from 'react'

/**
 * The character's vertical framing nudge (`character.imageOffsetY`), as the
 * inline styles each avatar variant paints it with.
 *
 * The stored value is a signed PERCENTAGE OF THE PICTURE (positive = down) —
 * see `imageOffsetY` in the core schema for why that unit, and not pixels, is
 * what lets one value frame the 224px header portrait and a 32px scene chip
 * alike. Everything here is about landing that percentage as the same fraction
 * of the picture in frames of wildly different size AND SHAPE.
 *
 * ── TWO THINGS TO KNOW BEFORE USING THESE ──
 *
 * **1. Which transform slot.** `translate`, `rotate`, `scale` and `transform`
 * are four separate properties and CSS composes them in that order — the matrix
 * is `translate · rotate · scale · transform`, so `transform` is applied to the
 * element FIRST (innermost, and therefore multiplied by `scale`) and `translate`
 * LAST (outermost, unaffected by it). Every avatar variant over-scans its
 * picture with `scale`, so the offset belongs in `transform`, where the zoom
 * multiplies it for free. Tailwind v4 spends `translate` + `scale` on the crop
 * utilities and leaves `transform` untouched, which is exactly that slot — so a
 * variant's hand-tuned lift and this nudge compose without a merge step.
 *
 * **2. Why the unit is `cqmax`, not `%`.** A translateY percentage resolves
 * against the element's HEIGHT, but the picture is not the element: the frames
 * are `object-cover` boxes of every shape holding one square source, so the
 * painted picture is a square as tall as the box's LONGER side. In a portrait
 * frame that is the height and `%` happens to be right; in a landscape scene
 * chip (52×28) the picture is 52 tall and `%` silently under-shifts by 28/52.
 * Measured before the fix: 7.00% on the portrait cards, 4.20% on the landscape
 * chips. `1cqmax` is 1% of the LARGER of the container's two axes — the picture
 * height in both shapes, computed by the browser instead of by a per-variant
 * table. Measured after: 7.000% in both.
 *
 * That is why the offset is TWO styles, not one: {@link avatarOffsetFrame} makes
 * the frame a size container so `cqmax` has something to resolve against, and
 * {@link avatarOffsetZoomed} spends it. A frame carrying the first MUST be
 * explicitly sized — `container-type: size` brings size containment, so a frame
 * that sized itself from its content would collapse. Every `Portrait` call site
 * passes an explicit box (`aspect-[3/4] w-16`, `h-8 w-[56px]`, `size-40`, …);
 * keep it that way.
 *
 * All three return `undefined` at 0 (and for an absent value), so an un-nudged
 * avatar carries no inline style at all — nothing to override, nothing to
 * explain in DevTools, no containment it never asked for, and byte-identical
 * markup to before the knob existed.
 */
export function avatarOffsetFrame(offsetY: number | undefined): CSSProperties | undefined {
  return offsetY ? { containerType: 'size' } : undefined
}

/** The offset itself, for a frame carrying {@link avatarOffsetFrame}. */
export function avatarOffsetZoomed(offsetY: number | undefined): CSSProperties | undefined {
  return offsetY ? { transform: `translateY(calc(${offsetY} * 1cqmax))` } : undefined
}

/**
 * The offset in the `translate` slot, for the character header — the one
 * variant whose `transform` AND `scale` are both driven by the scroll animation
 * (`.avatar-scroll-pan`, styles.css) and are not ours to touch.
 *
 * It needs neither of the above: its image is a SQUARE element laid out at the
 * resting painted size, so the element IS the picture and a plain `%` is already
 * a percentage of it. What it does cost is the zoom — `translate` sits outside
 * `scale`, and the header's rests at exactly 1 but reaches 1.213 as the header
 * collapses, so the offset lags it by that factor in the pinned tile. Accepted:
 * a fifth of a nudge on a 96px-tall tile, against re-entering a `var()` into
 * keyframes that are already hard enough to inspect (see .ai/gotchas-web.md).
 */
export function avatarOffsetFlat(offsetY: number | undefined): CSSProperties | undefined {
  return offsetY ? { translate: `0 ${offsetY}%` } : undefined
}
