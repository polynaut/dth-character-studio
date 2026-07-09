import { useEffect, useRef } from 'react'
import type { DependencyList } from 'react'

/**
 * Run `fn` whenever the window regains focus — the "re-read after the user
 * switched to another app and came back" pattern (e.g. picking up a file a Daz
 * or Houdini run just wrote). `fn` is held in a ref so it always sees the latest
 * closure without re-subscribing; `deps` only control the optional immediate
 * re-run.
 *
 * @param opts.immediate also run on mount and whenever `deps` change (for data
 *   that must load up-front, not only on a later refocus).
 */
export function useRefetchOnFocus(
  fn: () => void,
  deps: DependencyList = [],
  opts: { immediate?: boolean } = {},
): void {
  const fnRef = useRef(fn)
  fnRef.current = fn
  const immediate = opts.immediate ?? false
  useEffect(() => {
    const run = () => fnRef.current()
    if (immediate) run()
    window.addEventListener('focus', run)
    return () => window.removeEventListener('focus', run)
    // `deps` is the caller's re-run contract (mirrors useEffect); `fn` is a ref,
    // so a forwarded (non-literal) deps array is intentional here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
