import { useEffect, useRef } from 'react'

import { SceneLabel } from '#/components/character/scene-label.tsx'

/**
 * A page-level sticky "OVERRIDE" bar that pins right under the character header
 * (`--editor-header-h`) once you scroll to it, so the scene whose overrides you're
 * editing stays visible ALL the way down the page — which is what lets every panel's
 * own override toggle stay compact ("OVERRIDE" only). Shown only while an EXTRA
 * (non-primary) scene is selected; on the primary scene it collapses to nothing.
 *
 * It publishes its own height as `--override-bar-h` (a live ResizeObserver, 0 when
 * empty) so the ROM sticky tiers can pin BELOW it — `top: calc(--editor-header-h +
 * --override-bar-h)` — instead of colliding with it at the same offset.
 *
 * Lives as a direct child of `<main>` (before the contained editor body) so its
 * sticky containing block spans the whole page; `-mx-8/px-8` full-bleeds the bar to
 * the padded main's edges so content scrolls cleanly under it.
 */
export function StickyOverrideBar({
  scenePath,
  sceneName,
  show,
}: {
  scenePath: string
  sceneName: string
  show: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const update = () => root.style.setProperty('--override-bar-h', `${el.offsetHeight}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--override-bar-h')
    }
  }, [])
  return (
    <div
      ref={ref}
      className={`sticky z-[9] -mx-8${show ? ' mb-4 border-b bg-background/95 px-8 py-2 backdrop-blur-sm' : ''}`}
      style={{ top: 'var(--editor-header-h)' }}
    >
      {show && <SceneLabel scenePath={scenePath} name={sceneName} eyebrow="Override" />}
    </div>
  )
}
