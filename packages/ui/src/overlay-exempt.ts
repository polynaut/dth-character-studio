/**
 * Marks DOM regions whose clicks must never dismiss an overlay (Modal,
 * SidePanel). The host puts `data-overlay-dismiss-exempt` on a container —
 * its toast viewport, typically — and the overlays' outside-pointerdown
 * handlers swallow any pointerdown landing inside one.
 *
 * Why toasts need it: the host's toaster mounts OUTSIDE the Radix layer
 * (top-center, above z-50), so dismissing a toast — clicking its own ✕ — read
 * as an outside pointerdown and closed the drawer under it (measured
 * 2026-08-26: Rescan's success toast vs the Houdini utils drawer). The kit
 * stays toast-system-agnostic: it knows the attribute, not sonner.
 *
 * Checked at pointerdown time, so it also covers a toast that removes itself
 * from the DOM on click — the element is still attached when Radix asks.
 */
export const OVERLAY_DISMISS_EXEMPT_ATTR = 'data-overlay-dismiss-exempt'

/** True when `event`'s target sits inside an exempt region. */
export function isOverlayExemptPointerDown(event: Event): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest(`[${OVERLAY_DISMISS_EXEMPT_ATTR}]`) !== null
  )
}
