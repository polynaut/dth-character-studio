import { useEffect, useRef } from 'react'

import { SceneLabel } from '#/components/character/scene-label.tsx'

import type { ReactNode } from 'react'

/**
 * The sticky bar pinned right under the character header (`--editor-header-h`):
 * the editor's tab navigation on the LEFT, and — while an EXTRA (non-primary) Daz
 * scene is selected — the green "OVERRIDES <n> · <scene>" pill RIGHT-aligned, so
 * the scene whose overrides you're editing stays visible ALL the way down the
 * page (which is what lets every panel's own toggle stay compact).
 *
 * It publishes its own height as `--override-bar-h` (a live ResizeObserver) so the
 * ROM sticky tiers can pin BELOW it — `top: calc(--editor-header-h +
 * --override-bar-h)` — instead of colliding with it at the same offset.
 *
 * Lives as a direct child of `<main>` (before the contained editor body) so its
 * sticky containing block spans the whole page; `-mx-8/px-8` full-bleeds it to the
 * padded main's edges so content scrolls cleanly under it.
 */
export function StickyOverrideBar({
  scenePath,
  sceneName,
  show,
  overrideCount,
  children,
}: {
  scenePath: string
  sceneName: string
  /** True while an extra (non-primary) scene is selected — shows the override pill. */
  show: boolean
  /** How many of the scene's panels are actively overridden — the pill count. */
  overrideCount: number
  /** The tab navigation, rendered on the bar's left. */
  children: ReactNode
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
      className="sticky z-[9] -mx-8 mb-6 flex items-center justify-between gap-4 border-b bg-background/95 px-8 py-2 backdrop-blur-sm"
      style={{ top: 'var(--editor-header-h)' }}
    >
      {children}
      {/* The green scene pill, right-aligned: "OVERRIDES <n>" eyebrow over the
          scene name (the eyebrow uppercases via SceneLabel). */}
      {show && (
        <SceneLabel
          scenePath={scenePath}
          name={sceneName}
          eyebrow={`Overrides ${overrideCount}`}
        />
      )}
    </div>
  )
}
