import type { CSSProperties } from 'react'

/**
 * The character's vertical framing nudge (`character.imageOffsetY`), as the
 * inline style each avatar variant paints it with.
 *
 * The stored value is a signed PERCENTAGE OF THE PICTURE (positive = down) —
 * see `imageOffsetY` in the core schema for why that unit, and not pixels, is
 * what lets one value frame the 224px header portrait and a 32px scene chip
 * alike. Everything here is about getting that percentage into the right slot
 * of the CSS transform so it comes out as the same fraction of the picture in
 * every variant.
 *
 * ── THE ONE THING TO KNOW BEFORE USING THESE ──
 *
 * `translate`, `rotate`, `scale` and `transform` are FOUR separate properties
 * and CSS composes them in that order — the matrix is
 * `translate · rotate · scale · transform`, so `transform` is applied to the
 * element FIRST (innermost, and therefore multiplied by `scale`) and
 * `translate` LAST (outermost, unaffected by `scale`). Every avatar variant
 * over-scans its picture with `scale`, so which slot the offset lands in
 * decides whether it is a percentage of the PICTURE or of the frame:
 *
 *   • {@link avatarOffsetZoomed} → the `transform` slot. The percentage
 *     resolves against the image's own box and is then multiplied by the
 *     variant's zoom, which is exactly "n% of the painted picture". Use it
 *     wherever the crop is built from `translate`/`scale` utilities — i.e.
 *     everything that goes through `Portrait`.
 *   • {@link avatarOffsetFlat} → the `translate` slot, for the character
 *     header, whose `transform` AND `scale` are both driven by the scroll
 *     animation (`.avatar-scroll-pan`, styles.css) and are not ours to touch.
 *     Its image is laid out at the resting painted size and rests at
 *     `scale: 1`, so at rest the two agree exactly; as the header collapses to
 *     its pinned tile the zoom reaches 1.213 and the offset lags it by that
 *     factor. Deliberate: a fifth of a nudge on a 96px-tall tile, against
 *     re-entering a `var()` into the keyframes the pan is already hard enough
 *     to inspect through (see .ai/gotchas-web.md).
 *
 * Both return `undefined` at 0 (and for an absent value) so an un-nudged
 * avatar carries no inline style at all — nothing to override, nothing to
 * explain in DevTools, and byte-identical markup to before the knob existed.
 */
export function avatarOffsetZoomed(offsetY: number | undefined): CSSProperties | undefined {
  return offsetY ? { transform: `translateY(${offsetY}%)` } : undefined
}

/** The offset in the `translate` slot — see {@link avatarOffsetZoomed}. */
export function avatarOffsetFlat(offsetY: number | undefined): CSSProperties | undefined {
  return offsetY ? { translate: `0 ${offsetY}%` } : undefined
}
