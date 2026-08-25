import { useEffect, useInsertionEffect, useRef, useState } from 'react'

/**
 * Hold an async-started subscription (a native file watch, any event source
 * whose start is a promise) while `active` is true, and report whether it
 * actually armed. `start` resolves to a stop function — or null when watching
 * isn't available (a plain browser, a failed start) — and the armed flag is
 * what lets the caller degrade its polling to a heartbeat only when change
 * events will really arrive; unarmed, the poll stays the feature's sole
 * carrier at full speed.
 *
 * The startup is async, so the effect guards both directions: a teardown
 * arriving before `start` resolves stops the fresh subscription immediately,
 * and the armed flag never turns true for one already stopped. `start` is
 * read through a ref — the watch re-arms on `active` alone, so callers pass
 * an inline closure without re-arming every render.
 */
export function useArmedWatch(
  active: boolean,
  start: () => Promise<(() => void) | null>,
): boolean {
  // Latest-ref, written in an insertion effect (never during render — the
  // insertion phase still precedes every effect of the same commit).
  const startRef = useRef(start)
  useInsertionEffect(() => {
    startRef.current = start
  })
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!active) return
    let stop: (() => void) | null = null
    let disposed = false
    void startRef.current().then((stopper) => {
      if (!stopper) return
      if (disposed) {
        stopper()
        return
      }
      stop = stopper
      setArmed(true)
    })
    return () => {
      disposed = true
      stop?.()
      setArmed(false)
    }
  }, [active])
  return armed
}
