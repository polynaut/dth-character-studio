import { useSyncExternalStore } from 'react'

import {
  houdiniScanningSnapshot,
  subscribeHoudiniScanning,
} from './rom/houdini-scan-progress.ts'

/**
 * The Houdini projects hython is reading right now — for the card spinner.
 *
 * `useSyncExternalStore` rather than an effect + state: the store is written
 * from outside React (the api layer's scan funnel, on a background sweep nobody
 * rendered), and this is the primitive built for exactly that. It also means a
 * card mounting mid-scan gets the CURRENT set on its first render instead of
 * flashing "idle" for a frame.
 *
 * The server snapshot is the same empty set every time — a stable reference, or
 * the SSR check would loop. Nothing renders this on a server today, but a
 * missing third argument is a hydration error waiting for the first one that
 * does.
 */
const EMPTY: ReadonlySet<string> = new Set()

export function useHoudiniScanning(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeHoudiniScanning, houdiniScanningSnapshot, () => EMPTY)
}
