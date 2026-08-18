import { useCallback, useRef } from 'react'

/**
 * Serialize a shared async refresh: however many triggers fire — a watch
 * event, an interval tick, a window-focus refetch — at most ONE `refresh`
 * runs at a time, and a trigger landing mid-flight schedules exactly one
 * follow-up run instead of a second concurrent one.
 *
 * For refreshes whose read is DESTRUCTIVE (consuming a finished-run snapshot,
 * deleting the file it reports on): two concurrent runs would race over that
 * moment, while simply dropping the late trigger could skip the newest state.
 * The single follow-up run covers whatever the mid-flight trigger saw.
 *
 * The latest render's `refresh` is always the one called (a ref, the
 * useRefetchOnFocus pattern), and the returned function is referentially
 * stable — safe to capture in mount-constant effects, intervals and watches.
 * A rejection releases the busy latch (the follow-up marker survives into the
 * caller's next trigger) and propagates to the caller of THIS call alone.
 */
export function useCoalescedRefresh(refresh: () => Promise<void>): () => Promise<void> {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const busyRef = useRef(false)
  const againRef = useRef(false)
  return useCallback(async () => {
    if (busyRef.current) {
      againRef.current = true
      return
    }
    busyRef.current = true
    try {
      do {
        againRef.current = false
        // Sequential on purpose — running the follow-up AFTER the in-flight
        // refresh is the entire point (see the header).
        // Overlapping the two is precisely what this hook exists to prevent.
        // oxlint-disable-next-line no-await-in-loop
        await refreshRef.current()
      } while (againRef.current)
    } finally {
      busyRef.current = false
    }
  }, [])
}
