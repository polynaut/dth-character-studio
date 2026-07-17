import { useEffect, useState } from 'react'

import { resolveImageSrc, resolveScenePreview } from '#/lib/rom/api.ts'
import { cn } from '@dth/ui'

/**
 * Resolve a portrait's source URL from EITHER a stored avatar `image` reference
 * (see lib/rom/image) OR a Daz `scenePath` (.duf), whose sibling `.tip.png` is
 * read as a data URL. `scenePath` wins when both are passed. Returns '' until it
 * resolves — or when nothing is available — so the caller can show a fallback.
 */
export function usePortraitSrc({
  image = '',
  scenePath = '',
}: {
  image?: string
  scenePath?: string
}): string {
  const [src, setSrc] = useState('')
  // Scene previews change CONTENT under an unchanged path (Daz rewrites the
  // .tip.png on every scene save) — re-resolve on window focus so a card shows
  // the current preview after tabbing back from Daz, not the mount-time one.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    window.addEventListener('focus', bump)
    return () => window.removeEventListener('focus', bump)
  }, [])
  useEffect(() => {
    let active = true
    const resolve = scenePath
      ? resolveScenePreview(scenePath)
      : image
        ? resolveImageSrc(image)
        : Promise.resolve('')
    // Keep the previous image while re-resolving; only swap on a result (or
    // clear on failure) so focus refreshes don't flash the fallback initial.
    resolve.then((s) => active && setSrc(s)).catch(() => active && setSrc(''))
    return () => {
      active = false
    }
  }, [image, scenePath, tick])
  return src
}

/**
 * A portrait thumbnail. A fixed-aspect frame (its background fills any
 * transparency in the source) wraps an `<img>` that's cover-fit then — when
 * `zoom` — scaled up and nudged with translateY so the crop lands on the face /
 * upper body. The source is either a stored avatar `image` or a Daz `scenePath`
 * (its `.tip.png`) — see `usePortraitSrc`. Falls back to the name's initial.
 *
 * The transform lives on the inner image so it's cheap to tweak (e.g. the
 * translateY pan) without touching the frame. `className` sizes/rounds the
 * frame (e.g. `aspect-[3/4] w-16 rounded-md`); `imgClassName` overrides the
 * zoom/pan (twMerge wins on conflicts); `fallbackClassName` sizes the initial.
 */
export function Portrait({
  image,
  scenePath,
  name,
  zoom = true,
  className,
  imgClassName,
  fallbackClassName,
  src: srcOverride,
}: {
  image?: string
  scenePath?: string
  name: string
  zoom?: boolean
  className?: string
  imgClassName?: string
  fallbackClassName?: string
  /** A ready-to-use image URL (e.g. a static placeholder) — bypasses the
   *  image/scenePath resolution so a non-character avatar renders in the same
   *  frame (background, border, crop) as a real portrait. */
  src?: string
}) {
  const resolvedSrc = usePortraitSrc({ image, scenePath })
  const src = srcOverride ?? resolvedSrc
  return (
    <div className={cn('overflow-hidden border-2 border-neutral-500 bg-neutral-500', className)}>
      {src ? (
        <img
          src={src}
          alt=""
          className={cn(
            'size-full object-cover',
            zoom && 'origin-top -translate-x-[2%] -translate-y-[17%] scale-[2.3] object-top',
            imgClassName,
          )}
        />
      ) : (
        <div
          className={cn(
            'flex size-full items-center justify-center bg-muted font-bold text-muted-foreground',
            fallbackClassName,
          )}
        >
          {name.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  )
}
