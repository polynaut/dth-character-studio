import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'

import { Button, cn } from '@dth/ui'

import { PrimaryBadge } from '#/components/primary-badge.tsx'
import { SceneLabel } from '#/components/character/scene-label.tsx'

const stemOf = (p: string) => p.replace(/\\/g, '/').split('/').pop()?.replace(/\.duf$/i, '') ?? ''

/** The "primary" role badge shown on the primary scene's footer card (compact variant). */
const primaryTag = <PrimaryBadge dense />

/**
 * The scene-dock's per-card actions, OWNED by `DazSceneField` (which holds the
 * pick/copy/unlink flows and their modals) and shared with the dock through a ref
 * it populates — so the dock drives the same flows without duplicating them. The
 * ref is null until the field has mounted and populated it.
 */
export interface SceneDockActions {
  /** Pick + link another Daz scene (same flow as the up-page "Add scene"). */
  add: () => void
  /** Unlink a scene from the character (opens the field's confirm dialog). */
  remove: (scenePath: string) => void
}

/**
 * A docked "Daz scenes" DOCK — the same layout language as the project page's
 * Unreal-projects dock — that keeps the scenes you're editing on screen once the
 * Daz-scenes cards have scrolled out of view. A left column names the section and
 * carries an "Add scene" shortcut; then every linked scene follows as a card in a
 * horizontally-scrollable rail (subtle edge-fade on whichever side still has
 * scrolled-off scenes), with ‹ › arrows to page it. The SELECTED scene is ringed
 * green; clicking any card selects it (same as its full card up the page). Always
 * shown while scrolled (even for a single-scene character). `show` is owned by the
 * editor; the dock slides up on scroll-down and is inert while hidden. The page
 * keeps bottom padding so the last section can scroll clear of it.
 */
export function SceneFooter({
  show,
  scenes,
  primary,
  selected,
  onSelect,
  actionsRef,
}: {
  show: boolean
  /** Every linked scene path (the primary first, then extras). */
  scenes: Array<string>
  /** The primary scene's path (`character.scenePath`) — gets the "primary" tag. */
  primary: string
  /** The currently selected scene's path (`effectiveScene`) — ringed green. */
  selected: string
  onSelect: (scenePath: string) => void
  /** Per-card actions (add / unlink), populated by `DazSceneField`. Omitted → the
   *  "Add scene" button and the per-card unlink render disabled/absent. */
  actionsRef?: MutableRefObject<SceneDockActions | null>
}) {
  // Subtle edge-fade on the rail: fade whichever side still has scrolled-off
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
    // jsdom (component tests) has no ResizeObserver — guard so this stays inert there.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro?.disconnect()
    }
  }, [scenes.length])

  if (scenes.length === 0) return null
  // Show the scene's original filename (its .duf stem), same as the Daz-scene cards.
  const nameOf = (p: string) => stemOf(p)
  const railMask = `linear-gradient(to right, ${fade.left ? 'transparent' : '#000'}, #000 22px, #000 calc(100% - 22px), ${fade.right ? 'transparent' : '#000'})`
  const pageRail = (dir: -1 | 1) => railRef.current?.scrollBy({ left: dir * 260, behavior: 'smooth' })

  return (
    <div
      aria-hidden={!show}
      className={cn(
        'footer-3d fixed inset-x-0 bottom-0 z-20 backdrop-blur transition-transform duration-200 ease-out',
        show ? 'translate-y-0' : 'pointer-events-none translate-y-full',
      )}
    >
      {/* min-h matches the Unreal-projects dock so both docked bars line up. Here
          footer-3d (and so the 1px top border) is on the fixed wrapper, so the
          inner min-h is 70px (+1px border = 71px total). A `size="lg"` scene card
          is ~54px, like the Unreal card. */}
      <div className="flex min-h-[70px] items-center gap-3 px-6">
        {/* Left column: the section title with a compact "Add scene" shortcut
            stacked underneath — the same recipe as the Unreal dock's left column. */}
        <div className="mr-1 flex shrink-0 flex-col gap-1">
          <span className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            Daz scenes
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-fit gap-1 px-2 text-xs"
            disabled={!actionsRef}
            onClick={() => actionsRef?.current?.add()}
          >
            <Plus className="size-3.5" /> Add scene
          </Button>
        </div>

        {/* Divider between the title column and the scenes rail. */}
        <span className="h-9 w-px shrink-0 bg-border" aria-hidden />

        {/* Every linked scene as a card in a horizontally-scrollable rail (fits any
            number). The SELECTED one is ringed green; clicking a card selects it.
            The rail's `py-2` gives the hover-✕ (which sits just outside the card's
            top-right) room so `overflow-x-auto` — which forces overflow-y to auto —
            doesn't clip it or spawn a stray vertical scrollbar. */}
        <div
          ref={railRef}
          className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-2 [scrollbar-width:thin]"
          style={{ maskImage: railMask, WebkitMaskImage: railMask }}
        >
          {scenes.map((path) => {
            const isSelected = path === selected
            const isPrimary = path === primary
            return (
              // A wrapper (not a button) so the unlink ✕ is a SIBLING of the select
              // button, never a button nested in a button. The green ring / dim goes
              // on the wrapper so it still hugs the SceneLabel pill's radius.
              <div
                key={path}
                className={cn(
                  'group/scene relative shrink-0 rounded transition-opacity',
                  isSelected
                    ? 'ring-2 ring-daz-green ring-offset-0'
                    : 'opacity-65 hover:opacity-100 focus-within:opacity-100',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(path)}
                  title={isSelected ? nameOf(path) : `Switch to ${nameOf(path)}`}
                  className="block rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <SceneLabel
                    scenePath={path}
                    name={nameOf(path)}
                    accentBar
                    size="lg"
                    subline={isPrimary ? primaryTag : undefined}
                  />
                </button>
                {/* The primary can't be unlinked (it's also the avatar source), so
                    only extras get the ✕ — same recipe as the Unreal-dock card. */}
                {!isPrimary && actionsRef && (
                  <button
                    type="button"
                    aria-label={`Unlink ${nameOf(path)}`}
                    title="Unlink from character (the file is kept)"
                    onClick={() => actionsRef.current?.remove(path)}
                    className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border bg-card text-muted-foreground opacity-0 transition-[opacity,color] group-hover/scene:opacity-100 focus-visible:opacity-100 hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Rail pager — only shown when the rail actually overflows (so a lone
            card doesn't strand ‹ › over empty space); each arrow disables at its
            end. `fade` already tracks the scrolled-off sides. */}
        {(fade.left || fade.right) && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label="Scroll scenes left"
              disabled={!fade.left}
              onClick={() => pageRail(-1)}
              className="flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Scroll scenes right"
              disabled={!fade.right}
              onClick={() => pageRail(1)}
              className="flex size-8 items-center justify-center rounded-md border text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
