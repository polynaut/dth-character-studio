import { Check, ExternalLink, FolderOpen, Trash2 } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'

import { cn } from '../cn.ts'
import { Button } from '../primitives/button.tsx'

/**
 * A linked-asset card shell — the shared anatomy of the Daz-scene and Houdini
 * cards (and any future "linked file" card): a brand-coloured LEFT ACCENT BAR, a
 * media thumbnail, a title, an optional path chip + extra badge, and a
 * bottom-right control cluster (a hover remove button + an always-present open
 * button). Selectable cards additionally show a ring + a corner check when
 * selected. The reveal-icon in the corner previews the Alt+click "show in
 * Explorer" action.
 *
 * It's deliberately presentational: the app injects the native pieces as
 * slots — `media` (its own Portrait/logo), `chip` (its PathCode), `badge`
 * (a brand mark), `extra` (tags) — and the open/remove behaviour as callbacks.
 * The card itself imports nothing from Tauri, the router, or the filesystem, so
 * it is reusable by a future online build.
 */
export function LinkedAssetCard({
  title,
  media,
  badge,
  chip,
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
}: {
  title: string
  /** Thumbnail slot — the app's Portrait or a logo, sized by the caller. */
  media: ReactNode
  /** Brand mark floated bottom-left over the media. */
  badge?: ReactNode
  /** Path chip shown under the title. */
  chip?: ReactNode
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
}) {
  const CornerIcon = altHeld ? FolderOpen : ExternalLink
  const showCheck = Boolean(onSelect && selected)
  return (
    // Both the named group (the overlay buttons' hover-reveal) and the plain
    // `group` (the caller's `group-hover:` accentClass) live on the wrapper, so
    // the corner overlay button below accents on card hover too.
    <div className={cn('group group/card relative', width)}>
      <button
        type="button"
        onClick={onSelect ?? onOpen}
        data-alt-reveal=""
        // The selected fill + ring live on the card utility, keyed off this
        // attribute (so the whole appearance stays themeable in CSS).
        data-selected={showCheck ? 'true' : undefined}
        // Selectable mode is a toggle button — the ring alone is invisible to
        // assistive tech, so the selection state must also be aria-pressed.
        aria-pressed={onSelect ? (selected ?? false) : undefined}
        title={onSelect ? title : openTitle}
        className={cn(
          'relative flex h-full w-full items-stretch gap-3 rounded-lg border p-3 text-left transition-colors',
          cardClass,
        )}
      >
        <div className="relative shrink-0 self-start">
          {media}
          {badge}
        </div>
        <div className="flex min-w-0 flex-1 flex-col text-xs">
          <div className="truncate text-sm font-medium">{title}</div>
          {chip && <div className="mt-1">{chip}</div>}
          {/* Pinned to the bottom-left, clear of the corner controls. */}
          {extra && <div className="mt-auto pt-2">{extra}</div>}
        </div>
      </button>

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
            className="group/del pointer-events-auto opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100"
            title={removeTitle}
            aria-label={removeTitle}
            onClick={onRemove}
          >
            <Trash2 className="size-3.5 text-muted-foreground transition-colors group-hover/del:text-destructive" />
          </Button>
        )}
        {onSelect ? (
          // Selectable mode: the corner icon is the ONLY open target — a real
          // sibling <button>, never nested inside the main button (a focusable
          // interactive descendant is invalid HTML and the outer accessible name
          // swallows the inner label).
          <button
            type="button"
            data-alt-reveal=""
            title={openTitle}
            aria-label={openTitle}
            onClick={onOpen}
            className="pointer-events-auto rounded p-1 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <CornerIcon
              className={cn('size-4 text-muted-foreground transition-colors', accentClass)}
            />
          </button>
        ) : (
          // Non-selectable mode: the whole card opens, so this is a plain
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
