import { useEffect, useState } from 'react'

import { resolveScenePreview } from '#/lib/rom/api.ts'

import type { ReactNode } from 'react'

/**
 * Live preview of a picked Daz scene's tip thumbnail (read as a data URL) —
 * the avatar shown while creating a character or an attachment. Renders
 * nothing while the scene has no readable preview — including any `badge`,
 * which overlays the image (e.g. the create panel's derived-gender symbol)
 * and must not float in empty space without it.
 */
export function ScenePreview({ scenePath, badge }: { scenePath: string; badge?: ReactNode }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    if (!scenePath.trim()) {
      setSrc('')
      return
    }
    resolveScenePreview(scenePath.trim())
      .then((s) => active && setSrc(s))
      .catch(() => active && setSrc(''))
    return () => {
      active = false
    }
  }, [scenePath])
  if (!src) return null
  return (
    <div className="relative w-fit">
      <img
        src={src}
        alt=""
        className="aspect-[130/227] w-32 rounded-lg bg-[#262626] object-cover object-top"
      />
      {badge}
    </div>
  )
}
