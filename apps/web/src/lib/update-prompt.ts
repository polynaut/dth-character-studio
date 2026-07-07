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
  /** The installed version the update replaces - shown as the "from" reference. */
  currentVersion?: string
  /** Release notes (`update.body`); shown in a scrollable box when present. */
  notes?: string
  /** Releases between the installed version and the latest (exclusive of both),
   *  newest first, max 3 — shown as links to their GitHub release pages when the
   *  user is catching up across several versions. */
  skipped?: Array<{ version: string; url: string }>
  /**
   * Download + install + relaunch. On success the process exits, so this never
   * resolves; a rejection means the update failed and the dialog surfaces it.
   */
  install: () => Promise<void>
}

import { compareDthVersions } from '@dth/rom'

/**
 * The releases the user skipped between their installed version and the latest,
 * from the repo's release tags: strictly between the two (exclusive — the latest
 * is displayed in full right above), newest first, capped at 3, each linking to
 * its GitHub release page. Pure — tags may carry a leading `v`.
 */
export function skippedVersionsBetween(
  tags: Array<string>,
  installed: string,
  latest: string,
): Array<{ version: string; url: string }> {
  return tags
    .map((tag) => tag.replace(/^v/, ''))
    .filter(
      (v) => compareDthVersions(v, installed) > 0 && compareDthVersions(v, latest) < 0,
    )
    .sort((a, b) => compareDthVersions(b, a))
    .slice(0, 3)
    .map((version) => ({
      version,
      url: `https://github.com/polynaut/dth-character-studio/releases/tag/v${version}`,
    }))
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
