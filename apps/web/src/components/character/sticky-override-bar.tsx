import { useEffect, useRef } from 'react'

import { Switch } from '@dth/ui'

import { SceneLabel } from '#/components/character/scene-label.tsx'

/**
 * The FIRST per-scene override toggle — the HAIR one — lifted to page level as a
 * sticky bar so its big "OVERRIDE · <scene>" label pins right under the character
 * header (`--editor-header-h`) and stays visible ALL the way down. That persistent
 * scene context is what lets every OTHER panel's toggle (Genesis-9, ROM, preserve)
 * stay compact ("OVERRIDE" only). It IS the hair override switch — the Hair-items
 * FIELD stays in the sidebar, gated by this. Shown only while an EXTRA (non-primary)
 * scene is selected; on the primary scene it collapses to nothing.
 *
 * `position: sticky` is trapped in its parent's box, so the bar can't live inside a
 * panel and still reach the bottom — it lives as a direct child of `<main>` (before
 * the contained editor body). It publishes its own height as `--override-bar-h`
 * (live ResizeObserver, 0 when empty) so the ROM sticky tiers pin BELOW it —
 * `top: calc(--editor-header-h + --override-bar-h)` — instead of colliding. The
 * `-mx-8/px-8` full-bleeds it to the padded main's edges so content scrolls cleanly
 * under it.
 */
export function StickyOverrideBar({
  scenePath,
  sceneName,
  show,
  active,
  onToggle,
}: {
  scenePath: string
  sceneName: string
  show: boolean
  /** The hair override's armed state (this bar IS the hair toggle). */
  active: boolean
  onToggle: (enabled: boolean) => void
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
      {show && (
        <span className="flex items-center gap-3">
          <SceneLabel scenePath={scenePath} name={sceneName} eyebrow="Override" />
          <Switch
            checked={active}
            aria-label="Override the hair list for this scene"
            onCheckedChange={onToggle}
          />
        </span>
      )}
    </div>
  )
}
