import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import { useLayoutEffect } from 'react'
import type { ReactNode } from 'react'

import { Button } from './button.tsx'
import { closeFloatingLayers } from './overlay-sweep.ts'
import { cn } from '../cn.ts'
import { isOverlayExemptPointerDown } from '../overlay-exempt.ts'
import { isRefocusPointerDown } from '../refocus-click.ts'

/**
 * The kit's ONE modal shell — Radix Dialog wired with the semantics every
 * hand-rolled overlay was missing: `role="dialog"` + `aria-modal`, a real focus
 * trap, initial focus, focus restore on close, Escape and backdrop dismissal.
 * Compose the body freely; `title` is the accessible name every dialog must
 * have (screen readers announce it — without one a modal is announced as
 * nothing at all).
 *
 * Controlled only: pass `open` + `onClose`. While `dismissible` is false (e.g.
 * a busy delete), Escape / backdrop / the X are ignored — the caller's buttons
 * decide when it goes away.
 */
export function Modal({
  open,
  onClose,
  title,
  showClose = false,
  dismissible = true,
  className,
  children,
}: {
  open: boolean
  onClose: () => void
  /** The dialog's accessible name, rendered as its heading. */
  title: ReactNode
  /** Render an X close button beside the title. */
  showClose?: boolean
  /** false = Escape/backdrop/X won't close (e.g. while busy). */
  dismissible?: boolean
  /** Extra classes for the content card (e.g. a wider max width). */
  className?: string
  children: ReactNode
}) {
  // A dialog opening sweeps the floating layers that render ABOVE it: every
  // open InfoPopup (z-[60]) and any live tooltip (z-[100]). Both portal above
  // this z-50 layer — which is what makes them usable INSIDE a dialog — so one
  // left over from the control that opened the dialog would float over it.
  // The tooltip sweep also cancels a hover delay still counting down, which no
  // amount of hit-testing at show time can do.
  //
  // useLayoutEffect, not useEffect: a passive effect is deferred until AFTER
  // paint, so the browser may show one frame of this dialog with the old
  // tooltip still on top of it — the exact thing the sweep exists to prevent.
  // Nothing here reads layout, so running pre-paint costs nothing.
  useLayoutEffect(() => {
    if (!open) return
    closeFloatingLayers()
  }, [open])
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        // Controlled: Radix only ASKS to close (Escape, backdrop, X) — while
        // not dismissible the request is dropped and the dialog stays.
        if (!next && dismissible) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content
          // The body is free-form; callers put their description right in it.
          aria-describedby={undefined}
          // The click that re-focuses the app window is just bringing it to
          // the front — never a backdrop dismiss (see refocus-click.ts).
          // Neither is a click inside the host's toast layer — dismissing the
          // toast an action raised must not close the dialog that raised it
          // (see overlay-exempt.ts).
          onPointerDownOutside={(e) => {
            const original = e.detail.originalEvent
            if (isRefocusPointerDown(original) || isOverlayExemptPointerDown(original))
              e.preventDefault()
          }}
          className={cn(
            // max-w-xl (not -md): the dialogs regularly carry full file paths,
            // path chips and validation tables — at 28rem those wrapped/cramped.
            // Callers can still narrow/widen via className (tailwind-merge).
            'fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg outline-none',
            className,
          )}
        >
          {showClose ? (
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" className="size-7" aria-label="Close">
                  <X className="size-4" />
                </Button>
              </Dialog.Close>
            </div>
          ) : (
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
