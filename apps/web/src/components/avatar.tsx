import { useEffect, useState } from 'react'

import { usePortraitSrc } from '#/components/portrait.tsx'
import { avatarOffsetFlat } from '#/lib/avatar-offset.ts'
import { resolveImageSrc, resolveImageSrcAtSize } from '#/lib/rom/api.ts'
import { cn } from '@dth/ui'

/**
 * When `renderPx` is set (and no scene is being previewed), resolve the stored
 * avatar Lanczos3-downscaled (in Rust) to `renderPx × devicePixelRatio` — the
 * exact pixels it's painted at — so the browser paints it 1:1 with no aliasing.
 * Returns '' until it resolves (the caller shows the full image meanwhile).
 */
function useVariantSrc(image: string, scenePath: string | undefined, renderPx?: number): string {
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (!renderPx || scenePath || !image) {
      setSrc('')
      return
    }
    let active = true
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    resolveImageSrcAtSize(image, Math.round(renderPx * dpr))
      .then((r) => active && setSrc(r))
      .catch(() => active && setSrc(''))
    return () => {
      active = false
    }
  }, [image, scenePath, renderPx])
  return src
}

/** Resolve a stored avatar reference to a loadable URL (see lib/rom/api). */
export function useResolvedImage(image: string): string {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    resolveImageSrc(image)
      .then((resolved) => active && setSrc(resolved))
      .catch(() => active && setSrc(''))
    return () => {
      active = false
    }
  }, [image])
  return src
}

/**
 * Character avatar: shows the resolved image, or the name's initial as a
 * fallback — also used while the async resolve is in flight, or when a shared
 * character references a local image this machine doesn't have.
 *
 * `scenePath` (optional) overrides the stored image with that Daz scene's
 * `.tip.png` — the character editor passes the selected non-primary scene
 * here so the header portrait previews the look you're working on.
 *
 * `className` sizes/rounds both the image and the fallback box;
 * `fallbackClassName` (e.g. a text size) applies to the fallback only.
 */
export function Avatar({
  image,
  scenePath,
  name,
  offsetY,
  className,
  fallbackClassName,
  renderPx,
}: {
  image: string
  scenePath?: string
  name: string
  /** The character's `imageOffsetY` — its vertical framing nudge, a signed % of
   *  the picture. Applied in the `translate` slot, because this component's one
   *  zoomed consumer (the character header) spends `transform` and `scale` on
   *  the scroll animation — see lib/avatar-offset for what that costs. */
  offsetY?: number
  className?: string
  fallbackClassName?: string
  /** CSS px the image is painted at (longest side). When set, the stored avatar is
   *  served pre-downscaled to that size × the screen DPR (Rust Lanczos3) so the
   *  browser paints it 1:1 — crisp, anti-aliased, no GPU resampling. */
  renderPx?: number
}) {
  const base = usePortraitSrc({ image, scenePath })
  const variant = useVariantSrc(image, scenePath, renderPx)
  // While the variant resolves, fall back to the full image so nothing flashes.
  const src = renderPx && !scenePath ? variant || base : base
  if (src) {
    return (
      <img src={src} alt="" style={avatarOffsetFlat(offsetY)} className={cn('object-cover', className)} />
    )
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center bg-muted font-bold text-muted-foreground',
        className,
        fallbackClassName,
      )}
    >
      {name.charAt(0).toUpperCase()}
    </div>
  )
}
