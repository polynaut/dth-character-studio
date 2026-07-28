import { Check, ExternalLink, FolderOpen, Trash2 } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'

import { cn } from '../cn.ts'
import { Button } from '../primitives/button.tsx'

/**
 * A linked-asset card shell — the shared anatomy of the Daz-scene and Houdini
 * cards (and any future "linked file" card): a brand-coloured LEFT ACCENT BAR, a
 * media thumbnail, a title, an optional extra badge, and a bottom-right control
 * cluster (a hover remove button + an always-present open button). Selectable
 * cards additionally show a ring + a corner check when selected; `openIconOnly`
 * cards make the body inert so only the corner icon opens (for assets with no
 * per-card state to select). The reveal-icon in the corner previews the Alt+click
 * "show in Explorer" action.
 *
 * It's deliberately presentational: the app injects the native pieces as
 * slots — `media` (its own Portrait/logo), `badge` (a brand mark), `extra`
 * (tags) — and the open/remove behaviour as callbacks. The card itself imports
 * nothing from Tauri, the router, or the filesystem, so it is reusable by a
 * future online build.
 */
export function LinkedAssetCard({
  title,
  media,
  badge,
  extra,
  altHeld,
  openTitle,
  accentClass,
  cardClass,
  barClass,
  checkClass = 'bg-primary',
  width = 'w-80',
  onOpen,
  onRemove,
  removeTitle = 'Remove',
  selected,
  onSelect,
  openIconOnly = false,
}: {
  title: string
  /** Thumbnail slot — the app's Portrait or a logo, sized by the caller. */
  media: ReactNode
  /** Brand mark floated bottom-left over the media. */
  badge?: ReactNode
  /** Extra content pinned to the card's bottom-left (e.g. a "primary" tag). */
  extra?: ReactNode
  /** Alt is held → the corner icon previews "show in Explorer". */
  altHeld: boolean
  openTitle: string
  /** Hover accent for the corner icon, e.g. `group-hover:text-daz-green`. */
  accentClass?: string
  /** Extra class on the card, e.g. `daz-card` / `houdini-card` (fill + border +
   *  selected ring via `data-selected`). */
  cardClass?: string
  /** Background class for the left accent bar, e.g. `bg-daz-green`. Omit for no bar. */
  barClass?: string
  /** Background class for the selected-state corner check, e.g. `bg-daz-green`. */
  checkClass?: string
  width?: string
  onOpen: (e: MouseEvent) => void
  /** When set, a hover 🗑 appears (unlink — never a file delete). */
  onRemove?: () => void
  removeTitle?: string
  /** Selectable mode: highlights when `selected`; a card click SELECTS instead
   *  of opening — only the corner icon opens. Both optional (default = the
   *  classic whole-card-opens behavior). */
  selected?: boolean
  onSelect?: () => void
  /** Icon-only mode: the card body is inert — a click anywhere but the corner
   *  open icon is a no-op (no select, no whole-card open), and the body carries
   *  no title tooltip. For linked assets with no per-card state to select (e.g.
   *  Houdini projects). Ignored when `onSelect` is set. */
  openIconOnly?: boolean
}) {
  const CornerIcon = altHeld ? FolderOpen : ExternalLink
  const showCheck = Boolean(onSelect && selected)
  // The corner icon is the real (and only) open target in both selectable and
  // icon-only mode; only the whole-card-opens default leaves it a plain indicator.
  const cornerOpens = Boolean(onSelect) || openIconOnly
  // Icon-only mode makes the body a plain <div>: no click, no title tooltip, no
  // alt-reveal — the corner icon carries the sole action. `onSelect` still wins.
  const inertBody = openIconOnly && !onSelect
  const bodyClass = cn(
    'relative flex h-full w-full items-stretch gap-3 rounded-lg border p-3 pl-4 text-left transition-colors',
    cardClass,
  )
  const bodyInner = (
    <>
      <div className="relative shrink-0 self-start">
        {media}
        {badge}
      </div>
      <div className="flex min-w-0 flex-1 flex-col text-xs">
        <div className="mt-3 truncate text-base font-medium">{title}</div>
        {/* Sits just under the title (not pinned to the bottom). z-10 lifts it
            above the cover button, so an INTERACTIVE extra (the scene cards'
            edit-to-move path chip) receives its own clicks — nesting it inside
            a card <button> would be invalid HTML (see the corner buttons). */}
        {extra && <div className="relative z-10 mt-2 w-fit">{extra}</div>}
      </div>
    </>
  )
  return (
    // Both the named group (the overlay buttons' hover-reveal) and the plain
    // `group` (the caller's `group-hover:` accentClass) live on the wrapper, so
    // the corner overlay button below accents on card hover too.
    <div className={cn('group group/card relative', width)}>
      {/* The body is ALWAYS a plain div — select/open live on the transparent
          cover button below, so interactive content inside the body (the extra
          slot) stays valid HTML. The selected fill + ring stay keyed off this
          element's data-selected (the card utility's CSS). */}
      <div className={bodyClass} data-selected={showCheck ? 'true' : undefined}>
        {bodyInner}
      </div>
      {!inertBody && (
        // The card-wide action as a COVER: a transparent button stretched over
        // the body (interactive children lift above it with z-10; the corner
        // cluster and check are later siblings, naturally on top).
        <button
          type="button"
          onClick={onSelect ?? onOpen}
          data-alt-reveal=""
          // Selectable mode is a toggle button — the ring alone is invisible to
          // assistive tech, so the selection state must also be aria-pressed.
          aria-pressed={onSelect ? (selected ?? false) : undefined}
          aria-label={title}
          // Selectable body: no tooltip — the name is already the heading, and the
          // body selects (it doesn't open, so `openTitle` would mislead). Only the
          // whole-card-opens default carries the "Open…" tooltip on the body.
          title={onSelect ? undefined : openTitle}
          className="absolute inset-0 rounded-lg"
        />
      )}

      {/* Left accent bar — painted over the card's left edge (after the button so
          it sits on top), rounded to follow the card corners. */}
      {barClass && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-1.5 rounded-l-lg',
            barClass,
          )}
        />
      )}

      {/* Selected corner check (selectable cards only). */}
      {showCheck && (
        <span
          aria-hidden
          className={cn(
            'absolute top-2 right-2 flex size-5 items-center justify-center rounded-full text-white shadow-sm ring-2 ring-card',
            checkClass,
          )}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}

      {/* Bottom-right controls: a hover remove button + the always-present open
          affordance. `pointer-events-none` on the wrapper lets the plain open
          icon (non-selectable mode) fall through to the card button; each real
          button re-enables pointer events. */}
      <div className="pointer-events-none absolute right-2 bottom-2 flex items-center gap-0.5">
        {onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            // The adornment recipe (the chip pencil's style, size aside):
            // ghost at rest, solid #333 + white/20 edge + shadow on hover —
            // the ghost accent tint muddied on the tinted card surfaces. The
            // dark: pair is required — ghost's own dark:hover:bg-accent/50
            // would win the cascade.
            className="group/del pointer-events-auto border border-transparent opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100 hover:border-white/20 hover:bg-[#333] hover:shadow-sm dark:hover:bg-[#333]"
            title={removeTitle}
            aria-label={removeTitle}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5 text-muted-foreground transition-colors group-hover/del:text-destructive" />
          </Button>
        )}
        {cornerOpens ? (
          // Selectable / icon-only mode: the corner icon is the ONLY open target
          // — a real sibling Button (same ghost icon-sm size/shape/hover as the
          // remove button so the two align), never nested inside the main card
          // button (a focusable interactive descendant is invalid HTML and the
          // outer accessible name swallows the inner label).
          <Button
            variant="ghost"
            size="icon-sm"
            data-alt-reveal=""
            title={openTitle}
            aria-label={openTitle}
            onClick={onOpen}
            className="pointer-events-auto border border-transparent hover:border-white/20 hover:bg-[#333] hover:shadow-sm dark:hover:bg-[#333]"
          >
            <CornerIcon
              className={cn('size-3.5 text-muted-foreground transition-colors', accentClass)}
            />
          </Button>
        ) : (
          // Whole-card-opens default: the whole card opens, so this is a plain
          // indicator — pointer-events stay off so the click hits the card.
          <span className="p-1">
            <CornerIcon
              className={cn('size-4 text-muted-foreground transition-colors', accentClass)}
            />
          </span>
        )}
      </div>
    </div>
  )
}
