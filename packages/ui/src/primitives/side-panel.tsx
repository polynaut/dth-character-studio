import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { DismissableLayer, FocusScope } from 'radix-ui/internal'

import { Button } from './button.tsx'
import { cn } from '../cn.ts'

/** How long the slide / fade runs — keep in sync with the `duration-300` classes. */
const ANIM_MS = 300

/**
 * Backdrop clicks that arrive right after the window gained OS focus are
 * swallowed: when a file drop from Explorer opens the drawer while Explorer
 * keeps focus, the user's next click into the app is just bringing the window
 * to the front — closing the drawer on it would undo the drop they just made.
 * (The window's focus event fires before the click is delivered, so "has focus
 * right now" is always true by click time — recency is the reliable signal.)
 */
const FOCUS_CLICK_GRACE_MS = 400
let lastWindowFocusAt = 0
if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => {
    lastWindowFocusAt = Date.now()
  })
}

/**
 * A full-height overlay panel that slides in from the right (a "drawer"). The
 * backdrop fades in; the panel is `max-w-[50vw]` wide and scrolls its own body.
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
  className,
}: {
  open: boolean
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  /** Extra classes for the sliding panel (e.g. a different max width). */
  className?: string
}) {
  // `mounted` keeps the DOM during the slide-out; `shown` drives the transform —
  // toggled one frame after mount (slide in) and immediately on close (slide out).
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  const panelRef = useRef<HTMLElement>(null)
  const titleId = useId()

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
          onPointerDownOutside={(e) => {
            if (Date.now() - lastWindowFocusAt < FOCUS_CLICK_GRACE_MS) e.preventDefault()
          }}
          // Focus leaving must not dismiss (mirrors Radix Dialog's modal
          // content) — the trap above snaps focus back anyway.
          onFocusOutside={(e) => e.preventDefault()}
          onDismiss={onClose}
        >
          <aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className={cn(
              'absolute inset-y-0 right-0 flex h-full w-full max-w-[50vw] flex-col border-l bg-background shadow-2xl transition-transform duration-300 ease-out outline-none',
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
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={onClose}
              >
                <X className="size-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{children}</div>
          </aside>
        </DismissableLayer.Root>
      </FocusScope.Root>
    </div>,
    document.body,
  )
}
