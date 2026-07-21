import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dth/ui'
import { FormHeader } from '#/components/form-header.tsx'
import {
  dedupDazAssets,
  fetchSettings,
  installDazAssets,
  installDazMorphs,
  installDazPresets,
  installHoudiniPresets,
  listDazAssets,
  saveSettings,
  setAcceptedConflicts,
  uninstallDaz,
} from '#/lib/rom/api.ts'
import { CustomMorphsSection } from '#/components/tools/custom-morphs-section.tsx'
import { DangerZoneSection } from '#/components/tools/danger-zone-section.tsx'
import { DazAssetsSection } from '#/components/tools/daz-assets-section.tsx'
import { DazPresetsSection } from '#/components/tools/daz-presets-section.tsx'
import { DedupSection } from '#/components/tools/dedup-section.tsx'
import { HoudiniPresetsSection } from '#/components/tools/houdini-presets-section.tsx'
import { RefreshAssetsTab } from '#/components/tools/refresh-assets-tab.tsx'
import { useUnsavedChangesGuard } from '#/lib/use-unsaved-guard.ts'
import { useSettingsActions } from '#/lib/use-settings-actions.ts'
import { toast } from 'sonner'

import type { DedupReport, InstallReport } from '#/lib/rom/api.ts'

export const Route = createFileRoute('/tools')({
  // Optional `?tab=` deep-link (e.g. `?tab=refresh` from the About page).
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search.tab === 'string' ? { tab: search.tab } : {},
  loader: () => fetchSettings(),
  component: ToolsPage,
})

function ToolsPage() {
  const initial = Route.useLoaderData()
  const { tab } = Route.useSearch()
  const router = useRouter()

  // Reachable from several places, so return to wherever we came from (falling
  // back to the projects home if there's no history to pop) — like the About page.
  function goBack() {
    if (router.history.canGoBack()) router.history.back()
    else void router.navigate({ to: '/' })
  }

  const [settings, setSettings] = useState(initial)
  const [busy, setBusy] = useState(false)
  // Optional-tab install state (one busy flag + report per section).
  const [assetsBusy, setAssetsBusy] = useState(false)
  const [assetsReport, setAssetsReport] = useState<InstallReport | null>(null)
  const [dedupBusy, setDedupBusy] = useState(false)
  const [dedupReport, setDedupReport] = useState<DedupReport | null>(null)
  // Full asset PATHS the user picked to keep, overriding the auto-pick per dup
  // group (paths, not labels — exact-dup groups share labels by construction).
  const [keeperOverrides, setKeeperOverrides] = useState<Set<string>>(new Set())
  const [morphsBusy, setMorphsBusy] = useState(false)
  const [morphsReport, setMorphsReport] = useState<InstallReport | null>(null)
  const [presetsBusy, setPresetsBusy] = useState(false)
  const [presetsReport, setPresetsReport] = useState<InstallReport | null>(null)
  const [houdiniBusy, setHoudiniBusy] = useState(false)
  const [houdiniReport, setHoudiniReport] = useState<InstallReport | null>(null)
  // "Danger zone" — Daz uninstall cleanup.
  const [uninstallBusy, setUninstallBusy] = useState(false)
  const [uninstallReport, setUninstallReport] = useState<InstallReport | null>(null)
  const [uninstallConfirm, setUninstallConfirm] = useState(false)

  // Scoped to the fields THIS page edits (assets / morphs / presets / dedup /
  // uninstall). Save still writes the full settings object, but the Settings-page
  // fields are untouched here so they never flip this dirty.
  const dirty =
    settings.dazMorphsSource !== initial.dazMorphsSource ||
    settings.dazMorphsDest !== initial.dazMorphsDest ||
    settings.dazPresetsSource !== initial.dazPresetsSource ||
    settings.dazPresetsDest !== initial.dazPresetsDest ||
    settings.houdiniPresetsSource !== initial.houdiniPresetsSource ||
    settings.dedupQuarantineFolder !== initial.dedupQuarantineFolder ||
    JSON.stringify(settings.dazAssetsFolders) !== JSON.stringify(initial.dazAssetsFolders) ||
    JSON.stringify(settings.dazUninstallFolders) !== JSON.stringify(initial.dazUninstallFolders)
  // Leaving (or closing the window) with unsaved Tools edits asks first — the
  // same guard Settings and the character editor arm; without it these edits
  // were silently discarded.
  useUnsavedChangesGuard(dirty, 'You have unsaved settings — leave and lose them?')

  // Save pending edits before an install/scan/dedup, + the shared install runner.
  const { saveIfDirty, runInstall } = useSettingsActions({ dirty, settings, baseline: initial })

  // Saving stores the settings. Tools doesn't touch the active release, so it
  // just persists and re-validates dependent routes.
  async function onSave() {
    setBusy(true)
    try {
      await saveSettings({ data: { settings, baseline: initial } })
      await router.invalidate()
      toast.success('Saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Run a scoped install: persist pending edits first, then surface the per-step
  // report. On failure the first errored step's message is toasted verbatim — it
  // carries the "close all apps / restart as administrator" guidance.
  // --- Optional tab: asset-folder list editor + read-only scan ---
  function setAssetFolders(folders: Array<string>) {
    setSettings((s) => ({ ...s, dazAssetsFolders: folders }))
    // The scan/dry-run report is keyed to the old folder set — drop it so a stale
    // verdict can't drive the changed-only install below.
    setAssetsReport(null)
  }

  // --- "Danger zone": Daz uninstall cleanup folder list ---
  function setUninstallFolders(folders: Array<string>) {
    setSettings((s) => ({ ...s, dazUninstallFolders: folders }))
    setUninstallReport(null)
    setUninstallConfirm(false)
  }
  // Dry run (preview) or real delete. The real delete needs the inline confirm.
  async function runUninstall(dryRun: boolean) {
    setUninstallBusy(true)
    setUninstallReport(null)
    try {
      await saveIfDirty()
      const report = await uninstallDaz({ data: { dryRun } })
      setUninstallReport(report)
      setUninstallConfirm(false)
      const errs = report.steps.filter((s) => s.status === 'error').length
      if (dryRun) toast.success(`Dry run — ${report.totalFiles} file(s) in the folders that exist`)
      else if (errs) toast.warning(`Deleted with ${errs} error(s) — see the report`)
      else toast.success('Daz folders cleaned up')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setUninstallBusy(false)
    }
  }

  /** Read-only scan — no dryRun arg, so it can't go through runInstall. */
  async function runScan() {
    setAssetsBusy(true)
    setAssetsReport(null)
    try {
      await saveIfDirty()
      const report = await listDazAssets()
      setAssetsReport(report)
      toast.success(`Scanned ${report.steps.length} asset(s)`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setAssetsBusy(false)
    }
  }

  // Dedup: scan (dry run) finds conflicting shared files + duplicate assets; apply
  // rewrites every smaller copy to the largest and quarantines redundant assets.
  async function runDedup(dryRun: boolean) {
    setDedupBusy(true)
    if (dryRun) setDedupReport(null)
    try {
      await saveIfDirty()
      const report = await dedupDazAssets({
        data: { dryRun, keepers: dryRun ? [] : [...keeperOverrides] },
      })
      if (dryRun) {
        setDedupReport(report)
        const issues = report.conflicts.length + report.duplicates.length
        toast.success(
          issues === 0
            ? 'No duplicates or shared files found'
            : `Found ${report.duplicates.length} duplicate asset(s) and ${report.conflicts.length} shared file(s)`,
        )
      } else {
        // Quarantine failures come back on the report — report-level errors plus
        // per-member ones. They must be SHOWN, not clobbered by the follow-up scan.
        const failures =
          report.errors.length +
          report.duplicates.reduce((n, d) => n + d.members.filter((m) => m.error).length, 0)
        // The listing changed on disk — drop the stale asset scan and keeper picks.
        setAssetsReport(null)
        setKeeperOverrides(new Set())
        if (failures) {
          toast.warning(
            `Quarantined ${report.assetsQuarantined} duplicate asset(s) — ${failures} problem(s), see the report`,
          )
          // Keep the apply report visible so the errors can be read; the user
          // re-scans manually once they're resolved.
          setDedupReport(report)
        } else {
          toast.success(`Quarantined ${report.assetsQuarantined} duplicate asset(s)`)
          // Re-scan so the panel reflects what's now there.
          setDedupReport(await dedupDazAssets({ data: { dryRun: true } }))
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDedupBusy(false)
    }
  }

  // Accept a group of shared files as legitimately shared: persist them onto the
  // settings' acceptedConflicts, then re-scan so they drop out of the conflict
  // list (the scan/install then treats them as in-sync). `clear` un-accepts.
  async function acceptShared(rels: Array<string>, clear = false) {
    setDedupBusy(true)
    try {
      const acceptedConflicts = await setAcceptedConflicts(rels, clear)
      // Keep the in-memory settings in step with what we just wrote, so a later
      // Save (baseline-merged) doesn't revert the acceptance.
      setSettings((s) => ({ ...s, acceptedConflicts }))
      setDedupReport(await dedupDazAssets({ data: { dryRun: true } }))
      toast.success(clear ? 'Shared files un-accepted' : `Accepted ${rels.length} shared file(s)`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDedupBusy(false)
    }
  }

  // Override which copy of a duplicate group to keep — local only (no re-scan);
  // passed to Apply as full asset paths. Clears the group's other members so
  // exactly one is chosen.
  function chooseKeeper(groupPaths: Array<string>, keepPath: string) {
    setKeeperOverrides((prev) => {
      const next = new Set(prev)
      groupPaths.forEach((p) => next.delete(p))
      next.add(keepPath)
      return next
    })
  }

  // After a dry-run/scan, "Install" reuses its verdict: only the assets it flagged
  // as changed (status 'ok', with files to copy) are re-processed — the rest were
  // just confirmed installed, so the big already-installed assets aren't walked
  // again. A real-install report (dryRun false) doesn't prime this, so a plain
  // Install with no prior scan still does a full pass. Changed assets are still
  // re-walked when installed, so what's copied reflects the disk now, not the scan.
  const changedAssets =
    assetsReport?.dryRun === true
      ? assetsReport.steps.filter((s) => s.status === 'ok' && s.files > 0).map((s) => s.label)
      : []

  return (
    <main className="p-8">
      <FormHeader
        title="Tools"
        onBack={goBack}
        dirty={dirty}
        busy={busy}
        onDiscard={() => setSettings(initial)}
        onSave={() => void onSave()}
      />

      {/* CONTROLLED by the ?tab search param (not defaultValue) so the native
          "Refresh assets" menu deep-link switches tabs even when already on
          /tools — an uncontrolled Tabs ignored the URL change (same route match,
          no remount). onValueChange keeps the URL in sync when the user clicks. */}
      <Tabs
        value={tab === 'refresh' ? 'refresh' : 'install'}
        onValueChange={(value) =>
          void router.navigate({ to: '/tools', search: value === 'refresh' ? { tab: 'refresh' } : {} })
        }
        className="max-w-3xl"
      >
        <TabsList>
          <TabsTrigger value="install">Daz Studio &amp; Houdini</TabsTrigger>
          <TabsTrigger value="refresh">Refresh assets</TabsTrigger>
        </TabsList>

        <TabsContent value="install" className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Install your <em>own</em> Daz / Houdini content (not DTH release data). Folders are
            saved with your settings; each section installs from them on demand.
          </p>

          <DazAssetsSection
            folders={settings.dazAssetsFolders}
            onFoldersChange={setAssetFolders}
            busy={assetsBusy}
            report={assetsReport}
            onCloseReport={() => setAssetsReport(null)}
            changedAssets={changedAssets}
            onScan={() => void runScan()}
            onDryRun={() => runInstall(installDazAssets, true, setAssetsBusy, setAssetsReport)}
            onInstall={() =>
              runInstall(
                ({ data }) => installDazAssets({ data: { ...data, only: changedAssets } }),
                false,
                setAssetsBusy,
                setAssetsReport,
              )
            }
          />

          <DedupSection
            quarantineFolder={settings.dedupQuarantineFolder}
            onQuarantineFolderChange={(value) =>
              setSettings((s) => ({ ...s, dedupQuarantineFolder: value }))
            }
            busy={dedupBusy}
            report={dedupReport}
            keeperOverrides={keeperOverrides}
            onChooseKeeper={chooseKeeper}
            onAcceptShared={(rels) => void acceptShared(rels)}
            onCloseReport={() => setDedupReport(null)}
            onScan={() => void runDedup(true)}
            onApply={() => void runDedup(false)}
          />

          <CustomMorphsSection
            source={settings.dazMorphsSource}
            dest={settings.dazMorphsDest}
            onSourceChange={(value) => setSettings((s) => ({ ...s, dazMorphsSource: value }))}
            onDestChange={(value) => setSettings((s) => ({ ...s, dazMorphsDest: value }))}
            busy={morphsBusy}
            report={morphsReport}
            onCloseReport={() => setMorphsReport(null)}
            onDryRun={() => runInstall(installDazMorphs, true, setMorphsBusy, setMorphsReport)}
            onInstall={() => runInstall(installDazMorphs, false, setMorphsBusy, setMorphsReport)}
          />

          <DazPresetsSection
            source={settings.dazPresetsSource}
            dest={settings.dazPresetsDest}
            onSourceChange={(value) => setSettings((s) => ({ ...s, dazPresetsSource: value }))}
            onDestChange={(value) => setSettings((s) => ({ ...s, dazPresetsDest: value }))}
            busy={presetsBusy}
            report={presetsReport}
            onCloseReport={() => setPresetsReport(null)}
            onDryRun={() => runInstall(installDazPresets, true, setPresetsBusy, setPresetsReport)}
            onInstall={() => runInstall(installDazPresets, false, setPresetsBusy, setPresetsReport)}
          />

          <HoudiniPresetsSection
            source={settings.houdiniPresetsSource}
            onSourceChange={(value) => setSettings((s) => ({ ...s, houdiniPresetsSource: value }))}
            busy={houdiniBusy}
            report={houdiniReport}
            onCloseReport={() => setHoudiniReport(null)}
            onDryRun={() => runInstall(installHoudiniPresets, true, setHoudiniBusy, setHoudiniReport)}
            onInstall={() =>
              runInstall(installHoudiniPresets, false, setHoudiniBusy, setHoudiniReport)
            }
          />

          <DangerZoneSection
            folders={settings.dazUninstallFolders}
            onFoldersChange={setUninstallFolders}
            busy={uninstallBusy}
            report={uninstallReport}
            onCloseReport={() => setUninstallReport(null)}
            confirm={uninstallConfirm}
            onConfirmChange={setUninstallConfirm}
            onDryRun={() => void runUninstall(true)}
            onDelete={() => void runUninstall(false)}
          />
        </TabsContent>

        <TabsContent value="refresh" className="space-y-5">
          <RefreshAssetsTab />
        </TabsContent>
      </Tabs>
    </main>
  )
}
