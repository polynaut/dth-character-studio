import * as React from 'react'
import {
  arrow,
  autoUpdate,
  flip,
  FloatingArrow,
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
import { open as openExternal } from '@tauri-apps/plugin-shell'

import { cn } from '#/lib/utils.ts'

const ARROW_HEIGHT = 7
/** Gap between the "i" and the popup, on top of the arrow's own height. */
const GAP = 4

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
 */
export function InfoPopup({
  children,
  label = 'More information',
  className,
}: {
  children: React.ReactNode
  /** Accessible name for the trigger button. */
  label?: string
  /** Extra classes for the trigger button. */
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [pinned, setPinned] = React.useState(false)
  const arrowRef = React.useRef<SVGSVGElement>(null)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    // Any close (pointer leave, outside press, Escape) drops the pin too.
    if (!next) setPinned(false)
  }

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: handleOpenChange,
    placement: 'top',
    middleware: [
      offset(ARROW_HEIGHT + GAP),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      arrow({ element: arrowRef }),
    ],
    whileElementsMounted: autoUpdate,
  })

  // Hover + focus drive the popup only while it isn't pinned. safePolygon lets
  // the pointer travel from the "i" onto the popup (to reach links) without it
  // closing underneath the cursor.
  const hover = useHover(context, {
    enabled: !pinned,
    delay: { open: 90, close: 120 },
    handleClose: safePolygon(),
  })
  const focus = useFocus(context, { enabled: !pinned })
  const dismiss = useDismiss(context) // Escape + outside press — closes a pinned popup
  const role = useRole(context, { role: 'dialog' })

  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role])

  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: 150,
    initial: { opacity: 0, transform: 'scale(0.96)' },
  })

  function onTriggerClick() {
    if (pinned) {
      setPinned(false)
      setOpen(false)
    } else {
      setPinned(true)
      setOpen(true)
    }
  }

  // In the desktop app a bare <a href> would navigate the whole webview, so
  // route external links through the OS browser instead. Other links fall
  // through to default handling.
  function onContentClick(event: React.MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (href && /^https?:\/\//i.test(href)) {
      event.preventDefault()
      void openExternal(href)
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
        className={cn(
          'relative inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        {...getReferenceProps({ onClick: onTriggerClick })}
      >
        <span aria-hidden="true" className="font-serif text-sm font-bold italic leading-none">
          i
        </span>
      </button>

      {isMounted && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} className="z-50" {...getFloatingProps()}>
            <div
              style={transitionStyles}
              onClick={onContentClick}
              className="max-w-xs rounded-lg border border-white/10 bg-neutral-900 px-4 py-3 text-sm leading-relaxed text-neutral-100 shadow-2xl shadow-black/60 ring-1 ring-black/40 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_em]:italic [&_strong]:font-semibold"
            >
              {children}
              <FloatingArrow
                ref={arrowRef}
                context={context}
                height={ARROW_HEIGHT}
                width={ARROW_HEIGHT * 2}
                tipRadius={1}
                className="fill-neutral-900"
                stroke="rgb(255 255 255 / 0.1)"
                strokeWidth={1}
              />
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  )
}
