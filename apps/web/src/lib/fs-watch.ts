/**
 * Real filesystem watching for the native boundary — the alternative to
 * interval-polling wherever another process talks to the studio through files
 * (the Daz Runner's job-file pair, the verbose export progress log).
 *
 * A thin wrapper over the fs plugin's `watch` (the notify crate underneath —
 * ReadDirectoryChangesW on Windows, FSEvents on macOS). Deliberately
 * best-effort: it returns null in a plain browser and on ANY start failure,
 * and every caller keeps a poll as the safety net — armed watching only
 * SLOWS that poll to a heartbeat, it never replaces it. That stance is
 * load-bearing, not caution theater: change notification over SMB shares is
 * best-effort by design (the Daz library can live on a NAS drive), and a
 * watch that silently misses events must degrade to "updates arrive a
 * heartbeat later", never to "updates stop".
 *
 * The plugin import is dynamic and sits BEHIND the isTauri guard on purpose:
 * the vitest layer mocks '@tauri-apps/plugin-fs' per test file with factory
 * objects that don't know `watch`, and none of them needs to learn it for
 * code they never exercise.
 */
import { isTauri } from '@tauri-apps/api/core'

/** Stops the watch. Idempotent, never throws. */
export type StopWatching = () => void

export async function watchPaths(
  /** Files or directories (directories non-recursively). Paths that don't
   *  exist are skipped — notify refuses them — so callers pass dirs they know
   *  outlive the watch, not the transient files inside them. */
  paths: ReadonlyArray<string>,
  /** Called with the affected paths after each (debounced) burst of events. */
  onChange: (changed: Array<string>) => void,
  { delayMs = 250 }: { delayMs?: number } = {},
): Promise<StopWatching | null> {
  if (!isTauri() || paths.length === 0) return null
  try {
    const { exists, watch } = await import('@tauri-apps/plugin-fs')
    const there = await Promise.all(paths.map((path) => exists(path).catch(() => false)))
    const present = paths.filter((_, i) => there[i])
    if (present.length === 0) return null
    const unwatch = await watch(present, (event) => onChange(event.paths), { delayMs })
    return () => {
      try {
        unwatch()
      } catch {
        // already gone with its webview — nothing left to stop
      }
    }
  } catch {
    // No watch is a supported outcome (see the header) — the caller's poll
    // carries the feature alone, exactly like before watching existed.
    return null
  }
}
