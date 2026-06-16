import { useEffect, useState } from 'react'

import { resolveImageSrc } from '#/lib/rom/api.ts'
import { cn } from '#/lib/utils.ts'

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
 * `className` sizes/rounds both the image and the fallback box;
 * `fallbackClassName` (e.g. a text size) applies to the fallback only.
 */
export function Avatar({
  image,
  name,
  className,
  fallbackClassName,
}: {
  image: string
  name: string
  className?: string
  fallbackClassName?: string
}) {
  const src = useResolvedImage(image)
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
