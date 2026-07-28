import type { AnyRouter } from '@tanstack/react-router'

/**
 * Where the utility pages' Back goes: Tools / Settings / About return to the
 * page the user was on BEFORE entering the utility area — a HARD link, never
 * `history.back()`, which walks tab switches (and utility-to-utility hops)
 * one history entry at a time.
 *
 * One module-level subscription records the last non-utility href, so hopping
 * Tools → Settings still returns to the original entry point. A window that
 * STARTS on a utility page (reload / deep link) falls back to Home.
 */
const UTILITY_PREFIXES = ['/tools', '/settings', '/about']

let origin = '/'

function record(href: string, pathname: string) {
  if (!UTILITY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    origin = href
  }
}

/** The Back target for the utility pages. */
export function navOrigin(): string {
  return origin
}

/** Subscribe the tracker to the router — called once from the root route. */
export function trackNavOrigin(router: AnyRouter): () => void {
  record(router.state.location.href, router.state.location.pathname)
  return router.subscribe('onResolved', ({ toLocation }) => {
    record(toLocation.href, toLocation.pathname)
  })
}
