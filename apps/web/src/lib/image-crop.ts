/**
 * Pure math for the 1:1 avatar crop (see components/image-crop-editor.tsx).
 *
 * Model: the crop is a SQUARE rect in source-image pixels — side `size` with
 * top-left (`x`, `y`). The editor renders exactly that rect into its square
 * canvas viewport, so pan/zoom are pure transforms of this rect, and the
 * export draws the same rect at the output resolution. Keeping every value in
 * source pixels (never view pixels) makes the math independent of the
 * viewport's CSS size and testable without a canvas.
 *
 * Invariants (enforced by {@link clampCrop}, assuming the image passed
 * {@link MIN_AVATAR_SOURCE_PX} validation):
 *  - `MIN_AVATAR_SOURCE_PX ≤ size ≤ min(imageWidth, imageHeight)` — the user
 *    can never zoom in past a 256px source region (a smaller region would
 *    upscale into a blurry avatar) nor out past the largest square that fits.
 *  - The rect stays fully inside the image.
 */

/** Uploaded avatars must measure at least this on BOTH sides. */
export const MIN_AVATAR_SOURCE_PX = 256
/** …and at most this on both sides — bigger sources are refused outright
 *  (export a smaller copy first), keeping crop memory bounded. The STORED
 *  avatar is always downscaled to at most 512² regardless (see
 *  {@link avatarOutputSize}); this only bounds the source we'll crop from. */
export const MAX_AVATAR_SOURCE_PX = 2048

/** The two stored avatar resolutions (square). */
export const AVATAR_OUTPUT_SIZES = [256, 512] as const
export type AvatarOutputSize = (typeof AVATAR_OUTPUT_SIZES)[number]

/**
 * The PORTRAIT frame the square avatar is shown in — a 3:4 box, shared by the
 * character header (editor-header.tsx, ~130×173 at rest) and the gallery / Daz
 * scene thumbnails. The square is object-cover-cropped to this frame's centre
 * width; the crop editor overlays it as a letterbox guide so the user keeps the
 * subject inside the strip that survives portrait display, while the stored
 * image is still the full 1:1 square.
 */
export const AVATAR_PORTRAIT_ASPECT = 3 / 4

/** Each side letterbox bar's width, as a fraction of the square crop. */
export function portraitBarFraction(): number {
  return (1 - AVATAR_PORTRAIT_ASPECT) / 2
}

/**
 * Validate an upload's dimensions for the avatar pipeline: at least
 * {@link MIN_AVATAR_SOURCE_PX} and at most {@link MAX_AVATAR_SOURCE_PX} on
 * BOTH sides (aspect ratio is free — that's what the crop is for). Returns a
 * user-facing error message, or null when the image is usable.
 */
export function validateAvatarSource(width: number, height: number): string | null {
  if (width < MIN_AVATAR_SOURCE_PX || height < MIN_AVATAR_SOURCE_PX) {
    return `Image is too small — at least ${MIN_AVATAR_SOURCE_PX}px on both sides is needed (this one is ${width}×${height}).`
  }
  if (width > MAX_AVATAR_SOURCE_PX || height > MAX_AVATAR_SOURCE_PX) {
    return `Image is too large — at most ${MAX_AVATAR_SOURCE_PX}px on both sides is allowed (this one is ${width}×${height}). Export a smaller copy and try again.`
  }
  return null
}

export interface CropRect {
  /** Top-left of the square crop, in source-image pixels. */
  x: number
  y: number
  /** Side length of the square crop, in source-image pixels. */
  size: number
}

/** The initial crop: the largest square that fits, centered. */
export function initialCrop(imageWidth: number, imageHeight: number): CropRect {
  const size = Math.min(imageWidth, imageHeight)
  return { x: (imageWidth - size) / 2, y: (imageHeight - size) / 2, size }
}

/** Clamp a crop back into the invariants (size bounds first, then position —
 *  a size clamp can change how much slack the position has). */
export function clampCrop(crop: CropRect, imageWidth: number, imageHeight: number): CropRect {
  const maxSize = Math.min(imageWidth, imageHeight)
  const size = Math.min(Math.max(crop.size, Math.min(MIN_AVATAR_SOURCE_PX, maxSize)), maxSize)
  const x = Math.min(Math.max(crop.x, 0), imageWidth - size)
  const y = Math.min(Math.max(crop.y, 0), imageHeight - size)
  return { x, y, size }
}

/**
 * Pan by a pointer delta measured in VIEW pixels. Dragging moves the image
 * under the fixed viewport, so the crop rect moves OPPOSITE the pointer:
 * a drag to the right reveals more of the image's left side.
 */
export function panCrop(
  crop: CropRect,
  viewDx: number,
  viewDy: number,
  viewSize: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const scale = crop.size / viewSize
  return clampCrop(
    { x: crop.x - viewDx * scale, y: crop.y - viewDy * scale, size: crop.size },
    imageWidth,
    imageHeight,
  )
}

/**
 * Zoom by a factor (> 1 zooms IN — the crop rect shrinks), keeping the crop's
 * center fixed. The result is clamped, so zooming out at an edge slides the
 * rect back inside instead of escaping the image.
 */
export function zoomCrop(
  crop: CropRect,
  factor: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const size = crop.size / factor
  const cx = crop.x + crop.size / 2
  const cy = crop.y + crop.size / 2
  return clampCrop({ x: cx - size / 2, y: cy - size / 2, size }, imageWidth, imageHeight)
}

/**
 * The stored resolution for a crop: 512×512 when the cropped source region is
 * at least that big (no upscaling), else 256×256. These are the ONLY two
 * shapes ever written for an uploaded avatar, so previews render consistently
 * everywhere.
 */
export function avatarOutputSize(cropSize: number): AvatarOutputSize {
  return cropSize >= 512 ? 512 : 256
}

/**
 * The zoom slider's position for a crop, in [0, 1]: 0 = fully zoomed out (the
 * largest square), 1 = fully zoomed in (a MIN_AVATAR_SOURCE_PX region). For
 * images whose largest square IS the minimum, the range collapses — the
 * editor hides the slider then.
 */
export function zoomFraction(cropSize: number, imageWidth: number, imageHeight: number): number {
  const maxSize = Math.min(imageWidth, imageHeight)
  if (maxSize <= MIN_AVATAR_SOURCE_PX) return 0
  return (maxSize - cropSize) / (maxSize - MIN_AVATAR_SOURCE_PX)
}

/** Inverse of {@link zoomFraction}: the crop size for a slider position. */
export function cropSizeForZoomFraction(
  fraction: number,
  imageWidth: number,
  imageHeight: number,
): number {
  const maxSize = Math.min(imageWidth, imageHeight)
  return maxSize - fraction * (maxSize - Math.min(MIN_AVATAR_SOURCE_PX, maxSize))
}
