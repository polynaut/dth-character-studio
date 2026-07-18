import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from './button.tsx'
import { cn } from '../cn.ts'

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
          className={cn(
            'fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg outline-none',
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
