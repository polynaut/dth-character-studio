import { isTauri } from '@tauri-apps/api/core'
import { ask } from '@tauri-apps/plugin-dialog'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { toast } from 'sonner'

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

    const notes = update.body ? `\n\n${update.body}` : ''
    const accepted = await ask(
      `Version ${update.version} is available.${notes}\n\nDownload and install it now? The app will restart.`,
      {
        title: 'Update available',
        kind: 'info',
        okLabel: 'Update now',
        cancelLabel: 'Later',
      },
    )
    if (!accepted) return

    await update.downloadAndInstall()
    await relaunch()
  } catch (err) {
    // Update check is best-effort — a missing/locked release or offline state
    // shouldn't break startup.
    if (manual) toast.error('Update check failed — check your connection and try again.')
    console.warn('[updater] update check failed', err)
  }
}
