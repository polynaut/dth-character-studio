import { useEffect } from 'react'
import type { RefObject } from 'react'

/** The canonical CSS variable a mounted sticky page header publishes its live
 *  height into, on :root. Anything that must stay clear of the fixed top chrome
 *  reads it — the ROM section / column-title tiers pin right below it, and
 *  InfoPopup keeps its floating popup from overlapping it. */
export const STICKY_HEADER_VAR = '--sticky-header-h'

/**
 * Publish a sticky page header's live height into {@link STICKY_HEADER_VAR} on
 * :root, for the whole app to read (see the const's doc). Call it from every
 * `position: sticky; top: 0` page header.
 *
 * The height is DYNAMIC — the editor header collapses on scroll, and any
 * header's content (and so its height) changes as the design evolves; a
 * hardcoded px silently drifts. A ResizeObserver covers the scroll-driven
 * collapse AND content/resize reflows. Only one page header is mounted at a
 * time, so the single shared variable is unambiguous; it's removed on unmount so
 * a plain page (no header) reads nothing and consumers fall back to their own
 * default.
 */
export function useStickyHeaderInset<T extends HTMLElement>(ref: RefObject<T | null>) {
  useEffect(() => {
    const header = ref.current
    if (!header) return
    const root = document.documentElement
    const update = () => root.style.setProperty(STICKY_HEADER_VAR, `${header.offsetHeight}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(header)
    return () => {
      observer.disconnect()
      root.style.removeProperty(STICKY_HEADER_VAR)
    }
  }, [ref])
}
