import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dth/ui'
import { FormHeader } from '#/components/form-header.tsx'
import {
  dazToHueScriptsStatus,
  dedupDazAssets,
  fetchSettings,
  installDazAssets,
  installDazMorphs,
  installDazPresets,
  installDazToHueScripts,
  installHoudiniPresets,
  listDazAssets,
  quarantineStats,
  saveSettings,
  uninstallDaz,
} from '#/lib/rom/api.ts'
import { CustomMorphsSection } from '#/components/tools/custom-morphs-section.tsx'
import { DangerZoneSection } from '#/components/tools/danger-zone-section.tsx'
import { DazAssetsSection } from '#/components/tools/daz-assets-section.tsx'
import { DazPresetsSection } from '#/components/tools/daz-presets-section.tsx'
import { DazToHueScriptsSection } from '#/components/tools/daztohue-scripts-section.tsx'
import { DedupSection } from '#/components/tools/dedup-section.tsx'
import { HoudiniPresetsSection } from '#/components/tools/houdini-presets-section.tsx'
import { HousekeepingSection } from '#/components/tools/housekeeping-section.tsx'
import { RefreshAssetsTab } from '#/components/tools/refresh-assets-tab.tsx'
import { toast } from 'sonner'

import type { DazToHueScriptsStatus, DedupReport, InstallReport } from '#/lib/rom/api.ts'

export const Route = createFileRoute('/tools')({
  // Optional `?tab=` deep-link — the character editor's "Import from CSV" info
  // popup points here at the DazToHue-Scripts installer (`?tab=daztohue`).
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
  // Asset labels the user picked to keep, overriding the auto-pick per dup group.
  const [keeperOverrides, setKeeperOverrides] = useState<Set<string>>(new Set())
  const [morphsBusy, setMorphsBusy] = useState(false)
  const [morphsReport, setMorphsReport] = useState<InstallReport | null>(null)
  const [presetsBusy, setPresetsBusy] = useState(false)
  const [presetsReport, setPresetsReport] = useState<InstallReport | null>(null)
  const [houdiniBusy, setHoudiniBusy] = useState(false)
  const [houdiniReport, setHoudiniReport] = useState<InstallReport | null>(null)
  // "DazToHue-Scripts" tab — download + install the companion repo.
  const [scriptsBusy, setScriptsBusy] = useState(false)
  const [scriptsReport, setScriptsReport] = useState<InstallReport | null>(null)
  // Installed-vs-latest DazToHue-Scripts commit. null until the first check; the
  // check never throws (a failed remote lookup → state 'unknown').
  const [scriptsStatus, setScriptsStatus] = useState<DazToHueScriptsStatus | null>(null)
  async function loadScriptsStatus() {
    setScriptsStatus(await dazToHueScriptsStatus())
  }
  // "Danger zone" — Daz uninstall cleanup.
  const [uninstallBusy, setUninstallBusy] = useState(false)
  const [uninstallReport, setUninstallReport] = useState<InstallReport | null>(null)
  const [uninstallConfirm, setUninstallConfirm] = useState(false)
  // Housekeeping — quarantine size/empty (the sweep + empty actions live in the
  // section; the stats are shared with the dedup Apply, so they stay up here).
  const [quarantine, setQuarantine] = useState<{ files: number; bytes: number } | null>(null)
  async function loadQuarantineStats() {
    const stats = await quarantineStats()
    setQuarantine(stats.exists ? { files: stats.files, bytes: stats.bytes } : null)
  }

  // Check the installed-vs-latest scripts commit once on open (also re-checked
  // after a successful install). Fire-and-forget — the check swallows its own
  // errors, so there's nothing to catch here.
  useEffect(() => {
    void loadScriptsStatus()
    void loadQuarantineStats()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Saving stores the settings. Tools doesn't touch the active release, so it
  // just persists and re-validates dependent routes.
  async function onSave() {
    setBusy(true)
    try {
      await saveSettings({ data: settings })
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
  async function runInstall(
    install: (args: { data: { dryRun: boolean } }) => Promise<InstallReport>,
    dryRun: boolean,
    setBusyState: (value: boolean) => void,
    setReport: (report: InstallReport | null) => void,
    onComplete?: () => void,
    // Runs only after a successful (real, error-free) install — e.g. the DTH
    // release install re-scans the poses so the app works immediately.
    afterSuccess?: () => Promise<void> | void,
  ) {
    setBusyState(true)
    setReport(null)
    try {
      if (dirty) {
        await saveSettings({ data: settings })
        await router.invalidate()
      }
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
  }

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
      if (dirty) {
        await saveSettings({ data: settings })
        await router.invalidate()
      }
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
      if (dirty) {
        await saveSettings({ data: settings })
        await router.invalidate()
      }
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
      if (dirty) {
        await saveSettings({ data: settings })
        await router.invalidate()
      }
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
        toast.success(`Quarantined ${report.assetsQuarantined} duplicate asset(s)`)
        // The listing changed on disk — drop the stale asset scan, clear keeper
        // picks, and re-scan so the panel reflects what's now there.
        setAssetsReport(null)
        setKeeperOverrides(new Set())
        setDedupReport(await dedupDazAssets({ data: { dryRun: true } }))
        // The quarantine just grew — refresh its size readout.
        void loadQuarantineStats()
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDedupBusy(false)
    }
  }

  // Override which copy of a duplicate group to keep — local only (no re-scan);
  // passed to Apply. Clears the group's other members so exactly one is chosen.
  function chooseKeeper(groupLabels: Array<string>, keep: string) {
    setKeeperOverrides((prev) => {
      const next = new Set(prev)
      groupLabels.forEach((l) => next.delete(l))
      next.add(keep)
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

      <Tabs
        defaultValue={tab === 'install' ? 'install' : tab === 'refresh' ? 'refresh' : 'daztohue'}
        className="max-w-3xl"
      >
        <TabsList>
          <TabsTrigger value="daztohue">DazToHue-Scripts</TabsTrigger>
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
            onCloseReport={() => setDedupReport(null)}
            onScan={() => void runDedup(true)}
            onApply={() => void runDedup(false)}
          />

          <HousekeepingSection
            quarantineFolder={settings.dedupQuarantineFolder}
            quarantine={quarantine}
            onReloadStats={loadQuarantineStats}
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

        <TabsContent value="daztohue" className="space-y-5">
          <DazToHueScriptsSection
            dazLibraryFolder={settings.dazLibraryFolder}
            status={scriptsStatus}
            busy={scriptsBusy}
            report={scriptsReport}
            onCloseReport={() => setScriptsReport(null)}
            onDryRun={() =>
              runInstall(installDazToHueScripts, true, setScriptsBusy, setScriptsReport)
            }
            onInstall={() =>
              runInstall(
                installDazToHueScripts,
                false,
                setScriptsBusy,
                setScriptsReport,
                undefined,
                loadScriptsStatus, // re-check the installed-vs-latest commit
              )
            }
          />
        </TabsContent>

        <TabsContent value="refresh" className="space-y-5">
          <RefreshAssetsTab />
        </TabsContent>
      </Tabs>
    </main>
  )
}
