import { useSyncExternalStore } from 'react'

import {
  houdiniScanningSnapshot,
  subscribeHoudiniScanning,
} from './rom/houdini-scan-progress.ts'

/** The server snapshot, hoisted so it is the same reference every time — a
 *  fresh Set here would fail the SSR check the same way an unstable client
 *  snapshot loops the client one. */
const EMPTY: ReadonlySet<string> = new Set()

/**
 * The Houdini projects hython is reading right now — for the card spinner.
 *
 * `useSyncExternalStore` rather than an effect + state: the store is written
 * from outside React (the api layer's scan funnel, on a background sweep nobody
 * rendered), and this is the primitive built for exactly that. It also means a
 * card mounting mid-scan gets the CURRENT set on its first render instead of
 * flashing "idle" for a frame.
 *
 * Nothing renders this on a server today, but a missing third argument is a
 * hydration error waiting for the first one that does — hence {@link EMPTY}.
 */
export function useHoudiniScanning(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeHoudiniScanning, houdiniScanningSnapshot, () => EMPTY)
}
