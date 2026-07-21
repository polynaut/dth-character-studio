import { useCallback } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { saveSettings } from '#/lib/rom/api.ts'
import type { InstallReport } from '#/lib/rom/api.ts'
import type { StudioSettings } from '#/lib/rom/storage.ts'

/**
 * The "save pending settings edits, then act" machinery shared by the Settings and
 * Tools pages. Both pages let you edit machine folders (Daz library, Houdini docs,
 * …) and then run an install / scan / dedup that reads those folders — so any
 * dirty edit must reach disk FIRST. That preamble, plus the install/dry-run runner,
 * used to be copy-pasted (verbatim `runInstall` in both pages, and the `if (dirty)`
 * block re-inlined in ~5 actions). Centralising it keeps the "pending edits are
 * saved on install" contract in one place so the two pages can't drift.
 */
export function useSettingsActions(ctx: {
  dirty: boolean
  settings: StudioSettings
  baseline: StudioSettings
  /** Ran after `saveIfDirty` actually WROTE (never when clean). Settings passes
   *  its catalog rebuild here: a save-before-action persists an edited release
   *  selection (e.g. `currentDthVersion`) exactly like Save does, so the session
   *  pose catalog + the pinned-release banner must refresh too — even when the
   *  action itself is only a dry run. Own your failures inside it: a throw here
   *  aborts the caller's action. */
  onSaved?: () => Promise<void> | void
}) {
  const router = useRouter()
  const { dirty, settings, baseline, onSaved } = ctx

  /** Persist any pending settings edits (field-level baseline-merge) and refresh the
   *  loader, so the following action sees the just-chosen folders. No-op when clean. */
  const saveIfDirty = useCallback(async () => {
    if (dirty) {
      await saveSettings({ data: { settings, baseline } })
      await router.invalidate()
      await onSaved?.()
    }
  }, [dirty, settings, baseline, router, onSaved])

  /**
   * The shared install/dry-run runner: saves pending edits, runs `install`, shows
   * the report + a toast, and (on a real, error-free install) runs `afterSuccess`.
   * `setBusyState`/`setReport`/`onComplete` are the caller's per-action state.
   */
  const runInstall = useCallback(
    async (
      install: (args: { data: { dryRun: boolean } }) => Promise<InstallReport>,
      dryRun: boolean,
      setBusyState: (value: boolean) => void,
      setReport: (report: InstallReport | null) => void,
      onComplete?: () => void,
      afterSuccess?: () => Promise<void> | void,
    ) => {
      setBusyState(true)
      setReport(null)
      try {
        await saveIfDirty()
        const report = await install({ data: { dryRun } })
        setReport(report)
        const firstError = report.steps.find((step) => step.status === 'error')
        if (firstError) {
          toast.error(firstError.detail || 'Install failed')
        } else if (dryRun) {
          toast.success(`Dry run — would copy ${report.totalFiles} file(s)`)
        } else {
          toast.success(`Installed ${report.totalFiles} file(s)`)
          await afterSuccess?.()
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e))
      } finally {
        setBusyState(false)
        onComplete?.()
      }
    },
    [saveIfDirty],
  )

  return { saveIfDirty, runInstall }
}
