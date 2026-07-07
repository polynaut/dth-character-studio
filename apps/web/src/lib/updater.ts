import { invoke, isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { toast } from 'sonner'

import { requestUpdatePrompt, skippedVersionsBetween } from './update-prompt'

/**
 * Check GitHub Releases for a newer signed version. If one exists, ask the user;
 * on yes, download + install it and relaunch. Runs only in the packaged app —
 * no-ops in the plain web build (no Tauri) and under `pnpm dev:desktop`
 * (`import.meta.env.DEV`), so a dev build isn't offered an "update" to the
 * released version. Safe to call unconditionally.
 *
 * Called silently on startup. When invoked from the Help → Check for Updates menu
 * (`manual: true`) it also surfaces the "already up to date" / "not available in
 * dev" / "check failed" outcomes as toasts, so the click always gives feedback.
 *
 * When an update exists, the confirm is an app-styled React dialog (rendered by
 * `<UpdatePromptHost/>`, see components/update-prompt.tsx) rather than the native
 * OS dialog; that dialog owns the download/install + relaunch from here on.
 */
export async function checkForUpdates({ manual = false }: { manual?: boolean } = {}): Promise<void> {
  if (!isTauri() || import.meta.env.DEV) {
    if (manual) toast.info('Updates are only available in the installed app.')
    return
  }
  try {
    const update = await check()
    if (!update) {
      if (manual) toast.success("You're on the latest version.")
      return
    }

    // Catching up across several versions? List the skipped releases (between
    // installed and latest, newest first, max 3) as GitHub links under the
    // latest notes. Fetched via Rust (the CSP allows IPC only) — best-effort:
    // offline/rate-limited just means no list.
    let skipped: Array<{ version: string; url: string }> = []
    try {
      const tags = await invoke<Array<string>>('app_release_tags')
      skipped = skippedVersionsBetween(tags, update.currentVersion, update.version)
    } catch {
      // No list — the latest release's notes above still cover the update itself.
    }

    // App-styled React confirm (see components/update-prompt.tsx) instead of the
    // native ask(). The dialog drives the download/install + relaunch itself.
    requestUpdatePrompt({
      version: update.version,
      currentVersion: update.currentVersion,
      notes: update.body || undefined,
      skipped,
      install: async () => {
        await update.downloadAndInstall()
        await relaunch()
      },
    })
  } catch (err) {
    // Update check is best-effort — a missing/locked release or offline state
    // shouldn't break startup.
    if (manual) toast.error('Update check failed — check your connection and try again.')
    console.warn('[updater] update check failed', err)
  }
}
