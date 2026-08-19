import { Check, ExternalLink, FolderOpen, Loader2, Trash2, Wrench } from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'

import { cn } from '../cn.ts'
import { Button } from '../primitives/button.tsx'
import { EditableTitle } from './editable-title.tsx'

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
  busy = false,
  busyLabel = 'Working…',
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
  onReplace,
  replaceTitle = 'Replace',
  replaceDisabled = false,
  onUtils,
  utilsTitle = 'Utils',
  selected,
  onSelect,
  onRename,
  renameSubject = 'Scene',
  openIconOnly = false,
}: {
  title: string
  /** Thumbnail slot — the app's Portrait or a logo, sized by the caller. */
  media: ReactNode
  /** Inline-rename the title (the header's EditableTitle interaction: click →
   *  input, Enter/blur commits, Escape cancels). The title then sits ABOVE the
   *  cover button — clicking it edits instead of selecting. */
  onRename?: (next: string) => Promise<void> | void
  /** WHAT this card's title names — the noun in both the rename button's
   *  accessible name ("Rename Houdini project — Lara") and its input's ("Houdini
   *  project name"). Defaults to the Daz-scene wording the card shipped with.
   *  A card kind that leaves it at the default alongside another that doesn't
   *  is the bug this exists for: two titles announcing the identical
   *  "Rename — Kira" with only position to tell them apart. */
  renameSubject?: string
  /** Brand mark floated bottom-left over the media. */
  badge?: ReactNode
  /** Extra content pinned to the card's bottom-left (e.g. a "primary" tag). */
  extra?: ReactNode
  /** Something slow is happening TO this asset (the Houdini card's background
   *  scan) — the accent bar becomes the indicator: moving diagonal stripes
   *  travel down the brand stripe (`.busy-bar-sweep`, host CSS — a white
   *  overlay, so it works over whatever color `barClass` painted).
   *
   *  The bar on purpose: it is the one element the card shell already owns
   *  edge to edge, and lighting it up adds NO overlay to a card whose every
   *  corner is spoken for (`badge` bottom-left, `extra` under the title, the
   *  control cluster bottom-right, the selected check top-right). A card
   *  without a `barClass` falls back to a small spinner over the media's
   *  top-right corner — `busy` must never be silently invisible. Either way it
   *  is an indicator, not a blocker: the card stays fully interactive, because
   *  a scan is something the studio started on its own and must never take the
   *  user's controls away. */
  busy?: boolean
  /** What the busy indicator means, for assistive tech (the bar/spinner turns
   *  `role="status"` with this as its name). Always pass one when `busy` can
   *  be true — "something is happening" is not a message, and a bare animation
   *  is invisible to a screen reader. */
  busyLabel?: string
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
  /** When set, a hover folder button appears (browse for a replacement asset)
   *  — the primary Daz scene's swap flow uses it instead of a remove. */
  onReplace?: () => void
  replaceTitle?: string
  /** Show the replace button but refuse it. Deliberately NOT "hide it": a
   *  control that vanishes reads as a missing feature, while a disabled one
   *  whose `replaceTitle` explains the condition tells the user what to do
   *  about it. Native `disabled` (the kit has no focusable-disabled pattern),
   *  so the button leaves the tab order — the reason still reaches assistive
   *  tech through the aria-label, and the wrapping span carries the pointer
   *  tooltip. */
  replaceDisabled?: boolean
  /** When set, a hover 🔧 appears — per-asset tools that open their own UI
   *  (the Houdini card's material utilities). Purely a launcher: the card
   *  itself knows nothing about what the tools do. */
  onUtils?: () => void
  utilsTitle?: string
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
        {busy && !barClass && (
          // Fallback for a card WITHOUT an accent bar (the bar is the primary
          // busy indicator — see the accent-bar element): `role="status"` + the
          // label makes the spinner announce itself; the ring matches the
          // selected check's, so a spinner over a dark thumbnail stays
          // readable. Click-transparent — the card underneath keeps working
          // while the scan runs.
          <span
            role="status"
            aria-label={busyLabel}
            className="pointer-events-none absolute top-0 right-0 flex size-4 items-center justify-center rounded-full bg-card/90 shadow-sm ring-2 ring-card"
          >
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col text-xs">
        {/* Top-aligned with the media's upper edge (no push-down). On a
            SELECTABLE card the title row stops short of the right edge (mr-8,
            a MARGIN on purpose): the corner check bubble renders in that strip
            and must never overlap the title — and because the rename title is
            z-10 (above the cover button, so clicking the text edits), only a
            margin leaves the vacated top-right strip clickable for select;
            padding would still belong to the z-10 hitbox and swallow it. */}
        {onRename ? (
          <div className={cn('relative z-10 min-w-0', onSelect && 'mr-8')}>
            <EditableTitle
              name={title}
              onSave={onRename}
              ariaLabel={`${renameSubject} name`}
              subject={renameSubject}
              as="div"
              textClass="text-base font-medium"
            />
          </div>
        ) : (
          <div className={cn('truncate text-base font-medium', onSelect && 'pr-8')}>{title}</div>
        )}
        {/* Sits just under the title (not pinned to the bottom). z-10 lifts it
            above the cover button, so an INTERACTIVE extra (the scene cards'
            edit-to-move path chip) receives its own clicks — nesting it inside
            a card <button> would be invalid HTML (see the corner buttons). */}
        {extra && <div className="relative z-10 mt-1 w-fit">{extra}</div>}
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
          it sits on top), rounded to follow the card corners. While `busy` it IS
          the busy indicator: it turns `role="status"` (named by `busyLabel` — the
          animation alone is invisible to a screen reader) and moving diagonal
          stripes run down it (`.busy-bar-sweep`, host CSS; `overflow-hidden`
          keeps the pattern inside the stripe). Still click-transparent — the
          card underneath keeps working while the scan runs. */}
      {barClass && (
        <div
          role={busy ? 'status' : undefined}
          aria-label={busy ? busyLabel : undefined}
          aria-hidden={busy ? undefined : true}
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-1.5 overflow-hidden rounded-l-lg',
            barClass,
          )}
        >
          {busy && <span aria-hidden className="busy-bar-sweep absolute inset-0" />}
        </div>
      )}

      {/* Selected corner check (selectable cards only). Click-transparent so
          pressing the bubble itself still hits the cover button below —
          the whole top-right area toggles the selection. */}
      {showCheck && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-2 right-2 flex size-5 items-center justify-center rounded-full text-white shadow-sm ring-2 ring-card',
            checkClass,
          )}
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}

      {/* Bottom-right controls, destructive-to-primary left to right: the hover
          remove (bin) button FIRST, then replace/utils, the always-present open
          affordance last — the bin sits farthest from the open action so a
          hurried open never grazes it. `pointer-events-none` on the wrapper
          lets the plain open icon (non-selectable mode) fall through to the
          card button; each real button re-enables pointer events. */}
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
        {onReplace && (
          // The span carries the tooltip: a DISABLED button emits no hover
          // events, so a title on it alone would never appear — and the whole
          // point of disabling this one is that the reason must be readable.
          <span className="pointer-events-auto inline-flex" title={replaceTitle}>
            <Button
              variant="ghost"
              size="icon-sm"
              // Same adornment recipe as the remove button above.
              className="group/repl pointer-events-auto border border-transparent opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100 hover:border-white/20 hover:bg-[#333] hover:shadow-sm dark:hover:bg-[#333]"
              title={replaceTitle}
              aria-label={replaceTitle}
              disabled={replaceDisabled}
              onClick={onReplace}
            >
              <FolderOpen className="size-3.5 text-muted-foreground transition-colors group-hover/repl:text-foreground" />
            </Button>
          </span>
        )}
        {onUtils && (
          <Button
            variant="ghost"
            size="icon-sm"
            // Same hover-reveal adornment as the replace/remove buttons — the
            // corner cluster reads as one row of card actions.
            className="group/utils pointer-events-auto border border-transparent opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100 hover:border-white/20 hover:bg-[#333] hover:shadow-sm dark:hover:bg-[#333]"
            title={utilsTitle}
            aria-label={utilsTitle}
            onClick={onUtils}
          >
            <Wrench className="size-3.5 text-muted-foreground transition-colors group-hover/utils:text-foreground" />
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
