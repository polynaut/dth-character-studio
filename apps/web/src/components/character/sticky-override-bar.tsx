import { SceneLabel } from '#/components/character/scene-label.tsx'

import type { ReactNode } from 'react'

/**
 * The sticky bar pinned right under the character header (`--editor-header-h`, a
 * pure-CSS constant): the editor's tab navigation on the LEFT, and — while an
 * EXTRA (non-primary) Daz scene is selected — the green "OVERRIDES <n> · <scene>"
 * pill RIGHT-aligned, so the scene whose overrides you're editing stays visible
 * ALL the way down the page (which is what lets every panel's toggle stay compact).
 *
 * Sits ABOVE the header (z-20 > the header's z-10) so the pill, which is nudged up
 * into the header's zone, isn't covered by it. Lives as a direct child of `<main>`
 * (before the contained editor body) so its sticky containing block spans the whole
 * page; `-mx-8/px-8` full-bleeds it to the padded main's edges.
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
  return (
    <div
      className="sticky z-20 -mx-8 flex items-center justify-between gap-4 border-b bg-background/95 px-8 py-2 pb-4 backdrop-blur-sm"
      style={{ top: 'var(--editor-header-h)' }}
    >
      {children}
      {/* The green scene pill, right-aligned: "OVERRIDES <n>" eyebrow over the
          scene name (the eyebrow uppercases via SceneLabel), nudged up to align. */}
      {show && (
        <SceneLabel
          scenePath={scenePath}
          name={sceneName}
          eyebrow={`Overrides ${overrideCount}`}
          className="-mt-[23px]"
        />
      )}
    </div>
  )
}
