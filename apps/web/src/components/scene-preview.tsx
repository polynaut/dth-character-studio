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
  // The resolved thumbnail is KEYED by the path it belongs to; validity is
  // derived during render instead of a reset-effect, so a cleared or changed
  // scene never shows another path's preview while its own resolves.
  const path = scenePath.trim()
  const [resolved, setResolved] = useState({ key: '', src: '' })
  useEffect(() => {
    if (!path) return
    let active = true
    resolveScenePreview(path)
      .then((s) => active && setResolved({ key: path, src: s }))
      .catch(() => active && setResolved({ key: path, src: '' }))
    return () => {
      active = false
    }
  }, [path])
  const src = path && resolved.key === path ? resolved.src : ''
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
