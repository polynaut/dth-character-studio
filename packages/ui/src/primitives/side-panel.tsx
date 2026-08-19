import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { DismissableLayer, FocusScope } from 'radix-ui/internal'

import { Button } from './button.tsx'
import { closeFloatingLayers } from './overlay-sweep.ts'
import { cn } from '../cn.ts'
import { useUiConfig } from '../config.tsx'
import { isRefocusPointerDown } from '../refocus-click.ts'

/** How long the slide / fade runs — keep in sync with the `duration-300` classes. */
const ANIM_MS = 300

/**
 * A full-height overlay panel that slides in from the right (a "drawer"). The
 * backdrop fades in; the panel is `75vw` wide (capped at 1000px) and scrolls
 * its own body, between a fixed title bar and an optional `footer` bar pinned
 * to its bottom edge.
 * Esc or a backdrop click closes it. Portaled to <body> so a CSS-contained
 * ancestor can't capture its fixed positioning.
 *
 * Focus containment, Escape and outside-click dismissal, and focus restore on
 * close all come from Radix's own building blocks (`FocusScope` +
 * `DismissableLayer` — the same primitives Radix Dialog composes), not a
 * hand-rolled trap. Deliberately NOT the full modal Dialog: its
 * `disableOutsidePointerEvents` puts `pointer-events: none` on <body>, which
 * would break the app's file-drop hit-testing through the backdrop
 * (`elementsFromPoint` skips pointer-events-disabled elements) — dropping onto
 * a page zone while the drawer is open must keep working.
 *
 * Driven by `open`: it mounts, slides in, and on close slides out before
 * unmounting (so the exit animation plays). While open, body scroll is locked.
 */
export function SidePanel({
  open,
  title,
  onClose,
  children,
  footer,
  dismissible = true,
  className,
}: {
  open: boolean
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  /**
   * A bar pinned to the panel's bottom edge, OUTSIDE the scrolling body — for
   * the drawer's confirm/cancel actions.
   *
   * A footer inside the body cannot be both: it sits wherever the content ends
   * (mid-panel, with a tall empty area under it) until the content is long
   * enough to scroll, and only then does it reach the bottom. As its own flex
   * row beside the body it is always at the bottom and never scrolls away —
   * which is the whole point of putting an action in a full-height drawer.
   */
  footer?: ReactNode
  /**
   * false = Escape / the backdrop / the ✕ won't close it (e.g. while a handoff
   * is being written) — {@link Modal}'s prop of the same name, same meaning.
   *
   * It DISABLES the ✕ rather than only ignoring it. Passing a no-op `onClose`
   * achieves the ignoring half and leaves a button that looks live and does
   * nothing — beside a Cancel the caller greyed out properly, which is the
   * shape this prop exists to prevent.
   */
  dismissible?: boolean
  /** Extra classes for the sliding panel (e.g. a different max width). */
  className?: string
}) {
  // `mounted` keeps the DOM during the slide-out; `shown` drives the transform —
  // toggled one frame after mount (slide in) and immediately on close (slide out).
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const { dismissToasts } = useUiConfig()

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Double rAF: a single one fires BEFORE the freshly mounted (off-screen)
      // state has painted, so React coalesces mount + shown into ONE paint and
      // the slide-in never runs — the drawer just pops in. The second rAF lands
      // after that first paint, giving the transition a start state.
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setShown(true))
      })
      return () => {
        cancelAnimationFrame(raf1)
        cancelAnimationFrame(raf2)
      }
    }
    setShown(false)
    const timer = window.setTimeout(() => setMounted(false), ANIM_MS)
    return () => window.clearTimeout(timer)
  }, [open])

  // Same sweep as Modal: InfoPopups (z-[60]) and tooltips (z-[100]) portal
  // ABOVE this z-50 layer, so one left over from the control that opened the
  // drawer would float over it as it slides in. Pre-paint (useLayoutEffect) for
  // the same reason as Modal — see the comment there. The host's toasts stack
  // above z-50 too and outlive whatever action raised them, so a stale one
  // would float over the drawer just the same — swept via the config seam
  // (the kit has no toast system of its own).
  useLayoutEffect(() => {
    if (!open) return
    closeFloatingLayers()
    dismissToasts()
  }, [open, dismissToasts])

  // Lock body scroll while open (the non-modal layer doesn't).
  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className={cn(
          'absolute inset-0 bg-black/50 transition-opacity duration-300',
          shown ? 'opacity-100' : 'opacity-0',
        )}
      />
      <FocusScope.Root
        asChild
        loop
        // Stop trapping during the slide-out so the app can take focus back
        // right away; the unmount still restores focus to the opener.
        trapped={open}
        onMountAutoFocus={(e) => {
          // Radix would focus the first tabbable (the ✕ button); the panel
          // itself taking focus is calmer and reads the title first.
          e.preventDefault()
          panelRef.current?.focus()
        }}
      >
        <DismissableLayer.Root
          asChild
          // The click that re-focuses the app window (or follows a file drop
          // from a still-focused Explorer) is just bringing the window to the
          // front — never a dismiss (see refocus-click.ts).
          onPointerDownOutside={(e) => {
            if (isRefocusPointerDown(e.detail.originalEvent)) e.preventDefault()
          }}
          // Focus leaving must not dismiss (mirrors Radix Dialog's modal
          // content) — the trap above snaps focus back anyway.
          onFocusOutside={(e) => e.preventDefault()}
          // Radix only ASKS to dismiss (Escape, outside pointer down) — while
          // not dismissible the request is dropped and the drawer stays.
          onDismiss={() => {
            if (dismissible) onClose()
          }}
        >
          <aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn(
              'absolute inset-y-0 right-0 flex h-full w-[75vw] max-w-[1000px] flex-col border-l bg-background shadow-2xl transition-transform duration-300 ease-out outline-none',
              shown ? 'translate-x-0' : 'translate-x-full',
              className,
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b p-4">
              <h2 id={titleId} className="truncate text-lg font-semibold">
                {title}
              </h2>
              <Button
                variant="ghost"
                size="icon-sm"
                title="Close"
                aria-label="Close"
                disabled={!dismissible}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={onClose}
              >
                <X className="size-5" />
              </Button>
            </div>
            {/* min-h-0 is belt and braces, NOT what pins the footer. A flex
                item's `min-height: auto` does refuse to shrink below its
                content — but an item that is its own scroll container already
                resolves that to 0 (css-flexbox §4.5), so `overflow-y-auto`
                alone keeps the footer on the bottom edge; measured both ways in
                Chromium, identical. It stays so the invariant survives someone
                changing the overflow. */}
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
            {footer && <div className="shrink-0 border-t p-4">{footer}</div>}
          </aside>
        </DismissableLayer.Root>
      </FocusScope.Root>
    </div>,
    document.body,
  )
}
