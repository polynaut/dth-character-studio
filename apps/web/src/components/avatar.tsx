import { useEffect, useState } from 'react'

import { usePortraitSrc } from '#/components/portrait.tsx'
import { resolveImageSrc } from '#/lib/rom/api.ts'
import { cn } from '@dth/ui'

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
  className,
  fallbackClassName,
}: {
  image: string
  scenePath?: string
  name: string
  className?: string
  fallbackClassName?: string
}) {
  const src = usePortraitSrc({ image, scenePath })
  if (src) {
    return <img src={src} alt="" className={cn('object-cover', className)} />
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
