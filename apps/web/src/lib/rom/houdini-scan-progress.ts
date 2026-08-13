import { scanStoreKey } from './houdini-project-cache.ts'

/**
 * Which Houdini projects are being read by hython RIGHT NOW.
 *
 * A scan is the one thing in this feature the user cannot see: it happens on a
 * background sweep they never asked for, it takes tens of seconds per `.hip`,
 * and until it lands the card shows the PREVIOUS verdict — so a project whose
 * badge is about to appear (or clear) looks settled while it is still being
 * decided. This is the signal that lets a card say "still reading this one".
 *
 * **Only the projects that actually cost a hython trip are in here.** A scan
 * served from the mtime cache starts no process and finishes in microseconds;
 * marking those would flicker a spinner on every card on every page load, which
 * would train the eye to ignore it. `scanHoudiniMaterials` marks its `stale`
 * list — the files it is genuinely about to open — and nothing else.
 *
 * Deliberately a COUNTER per path, not a flag: the drawer's Rescan and the
 * background sweep can hold the same project at once (they are separate calls —
 * only identical batches coalesce), and a flag would let whichever finished
 * first clear a spinner the other still needs.
 *
 * Pure and app-agnostic — no Tauri, no React. `houdini-material.ts` marks,
 * `use-houdini-scanning.ts` subscribes, and this module knows about neither.
 */

/** How many in-flight scans hold each project, by {@link scanStoreKey}. */
const holders = new Map<string, number>()

/** The current set, rebuilt only when membership CHANGES. `useSyncExternalStore`
 *  re-renders whenever `getSnapshot()` returns a new reference, so handing back
 *  a fresh Set every call would loop forever. */
let snapshot: ReadonlySet<string> = new Set()

const listeners = new Set<() => void>()

/** The projects currently being read, as {@link scanStoreKey} keys. Stable by
 *  reference between changes — see {@link snapshot}. */
export function houdiniScanningSnapshot(): ReadonlySet<string> {
  return snapshot
}

/** Listen for changes. Returns the unsubscribe, in the shape
 *  `useSyncExternalStore` expects. */
export function subscribeHoudiniScanning(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Is this project being read? `hipPath` is matched the same separator- and
 *  case-insensitively as everywhere else a project path is compared. */
export function isHoudiniProjectScanning(
  scanning: ReadonlySet<string>,
  hipPath: string,
): boolean {
  return scanning.has(scanStoreKey(hipPath))
}

/**
 * Mark these projects as being read, and return the RELEASE.
 *
 * Returns a function rather than exposing an unmark so the two can never drift:
 * the caller's `finally` releases exactly what it took, once — a second call is
 * a no-op, so a `finally` that runs after an early return cannot decrement a
 * count some other scan still owns.
 */
export function markHoudiniScanning(hipPaths: ReadonlyArray<string>): () => void {
  const keys = hipPaths.map(scanStoreKey).filter((key) => key !== '')
  for (const key of keys) holders.set(key, (holders.get(key) ?? 0) + 1)
  publish()
  let released = false
  return () => {
    if (released) return
    released = true
    for (const key of keys) {
      const now = (holders.get(key) ?? 0) - 1
      if (now > 0) holders.set(key, now)
      else holders.delete(key)
    }
    publish()
  }
}

/** Rebuild the snapshot and notify — but only when the membership really moved,
 *  so a second holder arriving (or leaving) on an already-marked project does
 *  not re-render every card for nothing. */
function publish(): void {
  const next = new Set(holders.keys())
  if (next.size === snapshot.size && [...next].every((key) => snapshot.has(key))) return
  snapshot = next
  for (const listener of listeners) listener()
}

/** Test seam: drop all state. Never called by the app — the store is
 *  process-wide and a real release always pairs with its mark. */
export function resetHoudiniScanningForTests(): void {
  holders.clear()
  snapshot = new Set()
  listeners.clear()
}
