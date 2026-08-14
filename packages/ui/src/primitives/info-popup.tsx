import * as React from 'react'
import {
  arrow,
  autoUpdate,
  flip,
  FloatingArrow,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
} from '@floating-ui/react'
import { cn } from '../cn.ts'
import { useUiConfig } from '../config.tsx'
import { STICKY_HEADER_VAR } from '../hooks/use-sticky-header-inset.ts'

const ARROW_HEIGHT = 7
/** Gap between the "i" and the popup, on top of the arrow's own height. */
const GAP = 4
/** Minimum breathing room the popup keeps from the viewport edges. */
const EDGE = 8

/** Every OPEN popup registers a close callback here so the overlay layers can
 *  sweep them — see {@link closeAllInfoPopups}. */
const openPopups = new Set<() => void>()

/**
 * Close every currently-open InfoPopup (pinned or peeked). The popup portal
 * sits ABOVE the modal layers (`z-[60]` vs the dialogs' z-50 — that is what
 * makes an InfoPopup INSIDE a dialog work), so an overlay opening under a
 * still-open popup must sweep it first or the stale popup would float over the
 * new layer. Reached through `closeFloatingLayers()` (overlay-sweep.ts), which
 * Modal and SidePanel call on open — and `update-prompt.tsx` too, the one
 * overlay that appears with no user gesture at all.
 *
 * "Currently-open" undersells what this does now: EVERY mounted popup is
 * registered, so the sweep also cancels a peek still counting down. See
 * `sweptRef`.
 */
export function closeAllInfoPopups() {
  for (const close of [...openPopups]) close()
}

/**
 * The overflow padding for flip/shift: the usual {@link EDGE} on every side,
 * PLUS the live sticky-header height on top. The popup portal (`z-[60]`)
 * renders ABOVE the sticky page header (z-40), so without the inset a
 * `placement:"top"` popup with no room above the header would float OVER it —
 * the header inset makes it flip below and leave the header readable instead.
 * Read from the CSS var each compute (it's a derivable) so it tracks the
 * header collapsing on scroll; absent (a plain page) it's 0.
 */
function overflowPadding() {
  let headerH = 0
  if (typeof document !== 'undefined') {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(STICKY_HEADER_VAR)
    const parsed = Number.parseFloat(raw)
    if (Number.isFinite(parsed)) headerH = parsed
  }
  return { top: headerH + EDGE, right: EDGE, bottom: EDGE, left: EDGE }
}

/**
 * An "i" info trigger with a popup of rich text (bold / italic / links).
 *
 * Hovering the "i" *peeks* the popup like a tooltip — it fades in and hides
 * again when the pointer leaves. Clicking the "i" *pins* it open so longer text
 * can be read and links clicked; it then stays until an outside click, Escape,
 * or another click on the "i". Floating UI flips/shifts the popup to wherever
 * there's room and keeps the arrow pointing at the "i".
 *
 * Pass the content as children — any inline markup works:
 *   <span>IP65 <InfoPopup>Protected against <strong>dust</strong>. <a href="…">More</a></InfoPopup></span>
 *
 * Links are intercepted: an in-app path (`/settings`) navigates via the router,
 * while an external URL/scheme (`https://…`, `mailto:…`) opens in the OS browser.
 */
/** Trigger chip sizes: 'xs' is the 24px label-adjacent default; 'sm' / 'md'
 *  match the kit Button heights (h-8 / h-9), for an "i" sitting next to a
 *  button so the two read as one row. */
const TRIGGER_SIZE = {
  xs: 'size-6',
  sm: 'size-8',
  md: 'size-9',
} as const

export function InfoPopup({
  children,
  label = 'More information',
  className,
  size = 'xs',
}: {
  children: React.ReactNode
  /** Accessible name for the trigger button. */
  label?: string
  /** Extra classes for the trigger button. */
  className?: string
  /** Trigger chip size — see {@link TRIGGER_SIZE}. */
  size?: keyof typeof TRIGGER_SIZE
}) {
  const [open, setOpen] = React.useState(false)
  const [pinned, setPinned] = React.useState(false)
  const arrowRef = React.useRef<SVGSVGElement>(null)
  /**
   * Set when the overlay sweep ran while this popup was NOT yet open — i.e.
   * with a hover peek still counting down (`delay.open` below).
   *
   * `openPopups` can only ever close what is already open, so that pending peek
   * is invisible to the sweep: it fires afterwards and paints at `z-[60]` OVER
   * the z-50 dialog that just opened. And unlike a tooltip (pointer-events-none,
   * so it can never take a click) this popup is interactive — it does not just
   * look wrong, it SWALLOWS clicks aimed at the dialog underneath.
   *
   * TooltipHost has always guarded the same case on its side ("cancel one that
   * is counting down to appear"). This is that rule for the other layer: the
   * pending HOVER open becomes a no-op until the pointer leaves and comes back,
   * or the user deliberately clicks the "i". A focus open is never refused —
   * see handleOpenChange for why that scoping is not optional.
   */
  const sweptRef = React.useRef(false)
  const { onNavigate, onOpenExternal } = useUiConfig()

  function handleOpenChange(next: boolean, _event?: Event, reason?: string) {
    // A peek whose delay outlived the sweep. Refuse it — re-armed by the next
    // mouseenter or a click on the trigger, so this only ever eats the ONE
    // stale open, never the user's next genuine hover.
    //
    // ONLY reason 'hover', and that is load-bearing rather than tidy. The
    // sweep marks EVERY mounted popup stale, and the flag is cleared only by
    // `mouseenter` or a click — neither of which a keyboard user performs. So
    // refusing every reason left every popup on the page permanently
    // unopenable by Tab after the session's first dialog, since `useFocus`
    // opens with reason 'focus'. There is nothing to refuse there anyway: a
    // focus open is synchronous, so it cannot be a pending open that outlived
    // the sweep. The 90ms `delay.open` below is the only one that can.
    if (next && sweptRef.current && reason === 'hover') return
    // useFocus stays subscribed while pinned (its escape-key block-focus guard
    // must arm — see the useFocus call below), which also leaves its reference
    // blur-close live: Shift+Tabbing from the pinned dialog back over the "i"
    // and out would silently dismiss the pin. A pinned popup ignores
    // focus-reason closes; Escape ('escape-key') and outside-press still close.
    if (!next && reason === 'focus' && pinned) return
    setOpen(next)
    // Any close (outside press, Escape, unpin-click) drops the pin too.
    if (!next) setPinned(false)
  }

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: handleOpenChange,
    placement: 'top',
    middleware: [
      offset(ARROW_HEIGHT + GAP),
      // Derivable options (re-read each compute) so the header inset tracks the
      // header collapsing on scroll — see overflowPadding.
      flip(() => ({ padding: overflowPadding() })),
      shift(() => ({ padding: overflowPadding() })),
      arrow({ element: arrowRef }),
    ],
    whileElementsMounted: autoUpdate,
  })

  // Hover peeks the popup only while it isn't pinned. safePolygon lets the
  // pointer travel from the "i" onto the popup (to reach links) without it
  // closing underneath the cursor.
  const hover = useHover(context, {
    enabled: !pinned,
    delay: { open: 90, close: 120 },
    handleClose: safePolygon(),
  })
  // useFocus stays enabled while pinned (opening an already-open popup is a
  // no-op) — it must be SUBSCRIBED when useDismiss emits 'escape-key', or its
  // internal block-focus guard never arms and FloatingFocusManager's return
  // focus (:focus-visible under keyboard modality) re-peeks the popup the
  // instant Escape dismissed it.
  const focus = useFocus(context)
  const dismiss = useDismiss(context) // Escape + outside press — closes a pinned popup
  const role = useRole(context, { role: 'dialog' })

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role])

  // While open, register with the overlay sweep: an opening Modal/SidePanel
  // closes every popup so none floats over the new layer (the popup portal
  // renders above those layers — see closeAllInfoPopups).
  // Registered for EVERY mounted popup, not only open ones. Guarding this on
  // `open` was the bug: a peek still on its open delay had nothing in
  // `openPopups`, so the sweep passed over it and the popup landed on top of
  // the overlay a moment later. Always registering also lets the sweep set
  // `sweptRef`, which is what actually cancels that pending open.
  React.useEffect(() => {
    const close = () => {
      sweptRef.current = true
      setOpen(false)
      setPinned(false)
    }
    openPopups.add(close)
    return () => {
      openPopups.delete(close)
    }
  }, [])

  // Opacity-only fade — the floating element's positioning already owns its
  // `transform`, so the transition must not also animate transform.
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, { duration: 150 })

  function onTriggerClick() {
    // A deliberate click always wins over a sweep that refused a peek.
    sweptRef.current = false
    if (pinned) {
      setPinned(false)
      setOpen(false)
    } else {
      setPinned(true)
      setOpen(true)
    }
  }

  // Links inside the popup are intercepted so they don't replace the whole app
  // webview: an in-app path ("/settings", …) navigates via the router, and any
  // external scheme (http(s), mailto, …) opens in the OS default browser.
  function onContentClick(event: React.MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (!href) return
    // A root-relative path ("/settings") navigates in-app — but NOT a
    // protocol-relative "//host" (that's an external origin), which must fall
    // through to the external-open branch.
    if (href.startsWith('/') && !href.startsWith('//')) {
      event.preventDefault()
      setPinned(false)
      setOpen(false)
      onNavigate(href)
    } else if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) {
      event.preventDefault()
      onOpenExternal(href)
    } else {
      // A relative href (no leading "/", no scheme) matches neither branch —
      // without this it falls through to a default anchor navigation that
      // replaces the whole webview. There's no sensible target for one; eat it.
      event.preventDefault()
    }
  }

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        // `open` (and thus aria-expanded) is also true during a hover PEEK, so the
        // pressed-in look keys off `pinned` (a real click) instead — otherwise it fired
        // on hover too.
        data-pinned={pinned || undefined}
        className={cn(
          // A square icon-button chip (matching the override mark): a faint fill at
          // rest. On hover it just gains a darker border (the popup itself is the main
          // hover feedback). When PINNED (clicked) it presses in — a near-black fill
          // with a black inset shadow (+ a subtle light bottom bevel) so a pinned popup
          // reads as an active, recessed toggle.
          'relative inline-flex cursor-pointer items-center justify-center rounded-md bg-white/5 text-muted-foreground transition hover:text-foreground hover:ring-1 hover:ring-inset hover:ring-black/50 data-[pinned]:bg-[#0b0c0e] data-[pinned]:text-foreground data-[pinned]:shadow-[inset_0_1.5px_3px_rgb(0_0_0/0.85),inset_0_-1px_1px_rgb(255_255_255/0.05)] data-[pinned]:ring-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          TRIGGER_SIZE[size],
          className,
        )}
        // `onMouseEnter` re-arms after a sweep: the enter that started the
        // doomed timer fired BEFORE the sweep, so clearing here can only ever
        // affect the next, deliberate hover.
        {...getReferenceProps({
          onClick: onTriggerClick,
          onMouseEnter: () => {
            sweptRef.current = false
          },
        })}
      >
        <span
          aria-hidden="true"
          className={cn(
            'font-serif font-bold italic leading-none',
            size === 'xs' ? 'text-sm' : 'text-base',
          )}
        >
          i
        </span>
      </button>

      {isMounted && (
        <FloatingPortal>
          {/* Pinned = a real role="dialog" the user opened on purpose — move
              focus into it (first link, or the popup itself) so its links are
              reachable without tabbing across the whole page, and return focus
              to the "i" on close. Disabled while merely hover-peeking, so a
              pointer pass-over never steals focus. Non-modal: the popup isn't
              a focus trap, just a focus target. */}
          <FloatingFocusManager context={context} disabled={!pinned} modal={false}>
            <div
              ref={refs.setFloating}
              style={{ ...floatingStyles, ...transitionStyles }}
              // z-[60]: above modal dialogs and side panels (z-50) so popups
              // work INSIDE them — safe because those layers sweep any open
              // popup when they appear (closeAllInfoPopups), so nothing stale
              // ever floats over a fresh overlay. Below the tooltips (z-[100]).
              className="z-[60] max-w-xs rounded-lg border border-white/10 bg-neutral-900 px-4 py-3 text-sm leading-relaxed text-neutral-100 shadow-2xl [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_em]:italic [&_strong]:font-semibold"
              {...getFloatingProps({ onClick: onContentClick })}
            >
              {children}
              <FloatingArrow
                ref={arrowRef}
                context={context}
                height={ARROW_HEIGHT}
                width={ARROW_HEIGHT * 2}
                tipRadius={2}
                className="fill-neutral-900"
                stroke="rgb(255 255 255 / 0.1)"
                strokeWidth={1}
              />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  )
}
