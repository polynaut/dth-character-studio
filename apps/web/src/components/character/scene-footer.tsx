import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

import { cn } from '@dth/ui'

import { SceneLabel } from '#/components/character/scene-label.tsx'
import { prettySceneName } from '#/lib/scene-name.ts'

const stemOf = (p: string) => p.replace(/\\/g, '/').split('/').pop()?.replace(/\.duf$/i, '') ?? ''

/**
 * A stable, CSS-ident-safe `view-transition-name` for a scene. Scene paths aren't
 * valid idents (backslashes, colons, spaces), so hash the path to a short token —
 * the same scene keeps the same name whether it's the prominent pill or a rail one,
 * which is what lets the browser morph it between the two slots on selection.
 */
const vtName = (path: string) => {
  let h = 0
  for (let i = 0; i < path.length; i++) h = (Math.imul(31, h) + path.charCodeAt(i)) | 0
  return `scene-${(h >>> 0).toString(36)}`
}

/** The green "primary" tag shown on the primary scene's pill. */
const primaryTag = (
  <span className="rounded bg-[color-mix(in_oklab,var(--color-daz-green)_22%,transparent)] px-1 py-px text-[9px] font-semibold tracking-wide text-[color-mix(in_oklab,var(--color-daz-green)_82%,white)] uppercase">
    primary
  </span>
)

/**
 * A footer/status bar — the same idea as the project page's Unreal-projects bar —
 * that keeps the Daz scene you're editing on screen once the Daz-scenes cards have
 * scrolled out of view. The SELECTED scene sits prominent on the left; after a
 * divider, every OTHER linked scene follows in a horizontally-scrollable rail (with
 * a subtle edge-fade on whichever side has more scenes), so you can switch scene
 * mid-scroll — clicking a pill selects it (same as its card) and swaps it into the
 * prominent slot. Always shown while scrolled (even for a single-scene character —
 * then it just names the primary). `show` is owned by the editor; the bar slides up
 * on scroll-down and is inert while hidden. The page keeps bottom padding so the
 * last section can scroll clear of it.
 */
export function SceneFooter({
  show,
  scenes,
  primary,
  selected,
  characterName,
  onSelect,
}: {
  show: boolean
  /** Every linked scene path (the primary first, then extras). */
  scenes: Array<string>
  /** The primary scene's path (`character.scenePath`) — gets the "primary" tag. */
  primary: string
  /** The currently selected scene's path (`effectiveScene`) — shown prominent. */
  selected: string
  characterName: string
  onSelect: (scenePath: string) => void
}) {
  const others = scenes.filter((p) => p !== selected)
  // Subtle edge-fade on the others rail: fade whichever side still has scrolled-off
  // scenes, so a long list hints that it scrolls — and nothing fades when they fit.
  const railRef = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ left: false, right: false })
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const update = () =>
      setFade({
        left: el.scrollLeft > 4,
        right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
      })
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [others.length])

  // Selecting a pill reorders the rail (the clicked scene swaps into the prominent
  // slot; the rest shift to fill in). Wrap the state change in a view transition so
  // each pill — which carries a stable `view-transition-name` — slides from its old
  // slot to its new one instead of snapping. `flushSync` makes React apply the
  // selection synchronously inside the transition callback so the browser captures
  // the "after" layout. Falls back to a plain select when unsupported or the user
  // prefers reduced motion.
  const selectScene = (path: string) => {
    if (
      path === selected ||
      typeof document.startViewTransition !== 'function' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      onSelect(path)
      return
    }
    document.startViewTransition(() => flushSync(() => onSelect(path)))
  }

  if (scenes.length === 0) return null
  const nameOf = (p: string) => prettySceneName(stemOf(p), characterName)
  const railMask = `linear-gradient(to right, ${fade.left ? 'transparent' : '#000'}, #000 22px, #000 calc(100% - 22px), ${fade.right ? 'transparent' : '#000'})`

  return (
    <div
      aria-hidden={!show}
      className={cn(
        'fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur transition-transform duration-200 ease-out',
        show ? 'translate-y-0' : 'pointer-events-none translate-y-full',
      )}
    >
      <div className="flex items-center gap-3 px-4 py-2">
        {/* The selected scene, prominent — a green ring, never dimmed. The radius
            MUST match the SceneLabel pill's (`Tag` uses `rounded`) so the ring hugs
            its silhouette instead of bulging past its corners. No ring offset
            (`ring-offset-0`) so the ring sits flush on the pill edge. */}
        <span
          style={{ viewTransitionName: vtName(selected), viewTransitionClass: 'scene-pill' }}
          className="shrink-0 rounded ring-2 ring-daz-green ring-offset-0"
        >
          <SceneLabel
            scenePath={selected}
            name={nameOf(selected)}
            accentBar
            trailing={selected === primary ? primaryTag : undefined}
          />
        </span>

        {others.length > 0 && (
          <>
            <span className="h-8 w-px shrink-0 bg-border" aria-hidden />
            {/* Every other scene — a horizontally-scrollable rail (fits any number).
                Click one to switch; it swaps into the prominent slot. */}
            <div
              ref={railRef}
              className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-0.5 [scrollbar-width:thin]"
              style={{ maskImage: railMask, WebkitMaskImage: railMask }}
            >
              {others.map((path) => (
                <button
                  key={path}
                  type="button"
                  style={{ viewTransitionName: vtName(path), viewTransitionClass: 'scene-pill' }}
                  onClick={() => selectScene(path)}
                  title={`Switch to ${nameOf(path)}`}
                  className="shrink-0 rounded opacity-65 transition-opacity outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <SceneLabel
                    scenePath={path}
                    name={nameOf(path)}
                    accentBar
                    trailing={path === primary ? primaryTag : undefined}
                  />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
