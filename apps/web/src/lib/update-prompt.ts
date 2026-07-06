/**
 * Tiny imperative store that bridges the (non-React) updater flow to a
 * React-rendered confirm dialog. `checkForUpdates()` (lib/updater.ts) calls
 * `requestUpdatePrompt()` with the version, release notes and an install action;
 * the mounted `<UpdatePromptHost/>` (components/update-prompt.tsx) renders the
 * app-styled dialog and drives the install. Modeled on how sonner's `toast()`
 * feeds a single `<Toaster/>` — no React context needed, so the updater stays a
 * plain function callable from startup and the Help menu.
 */
export type UpdatePromptRequest = {
  /** The available version, e.g. "0.31.2". */
  version: string
  /** Release notes (`update.body`); shown in a scrollable box when present. */
  notes?: string
  /**
   * Download + install + relaunch. On success the process exits, so this never
   * resolves; a rejection means the update failed and the dialog surfaces it.
   */
  install: () => Promise<void>
}

let current: UpdatePromptRequest | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

/** Open (or replace) the update dialog. Safe to call before the host mounts —
 *  the host reads the current request on mount. */
export function requestUpdatePrompt(req: UpdatePromptRequest): void {
  current = req
  emit()
}

/** Dismiss the dialog ("Later"/Esc/backdrop). */
export function clearUpdatePrompt(): void {
  current = null
  emit()
}

/** Subscribe for `useSyncExternalStore`; returns an unsubscribe. */
export function subscribeUpdatePrompt(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Current request (or null). Stable reference between changes. */
export function getUpdatePrompt(): UpdatePromptRequest | null {
  return current
}
