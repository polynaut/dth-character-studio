import { useEffect, useState, type ReactNode } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  FolderOpen,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { poseAssetCsvEra } from '@dth/rom'

import { Button, InfoPopup, Input, Tabs, TabsContent, TabsList, TabsTrigger } from '@dth/ui'
import { FormHeader } from '#/components/form-header.tsx'
import {
  DAZTOHUE_SCRIPTS_REPO,
  dazToHueScriptsStatus,
  dedupDazAssets,
  defaultDazUninstallFolders,
  detectAssetVersions,
  emptyQuarantine,
  fetchSettings,
  housekeepingSweep,
  installDazAssets,
  installDazMorphs,
  installDazPresets,
  installDazToHueScripts,
  installHoudiniPresets,
  listDazAssets,
  NOTE_MEDIA_RETENTION_DAYS,
  PRODUCT_SCAN_RETENTION_DAYS,
  quarantineStats,
  refreshAllAssets,
  saveSettings,
  uninstallDaz,
} from '#/lib/rom/api.ts'
import { daztohueScriptsDir } from '#/lib/rom/storage.ts'
import { openExternal, pickFolder } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { PathCode } from '#/components/path-code.tsx'
import { FolderField, InstallReportList, ReportClose } from '#/components/install-controls.tsx'
import { toast } from 'sonner'

import type {
  AssetVersionReport,
  ConflictCopy,
  DazToHueScriptsStatus,
  DedupReport,
  FileConflict,
  InstallReport,
  RefreshSummary,
} from '#/lib/rom/api.ts'

/** The morph-scanning script the install is mainly there to deliver. */
const DTH_SCAN_FRAMES_URL = `${DAZTOHUE_SCRIPTS_REPO}/blob/main/DthScanFrames.dsa`

/** Human-readable byte size (e.g. 1536 → "1.5 KB"), for the housekeeping readouts. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

export const Route = createFileRoute('/tools')({
  // Optional `?tab=` deep-link — the character editor's "Import from CSV" info
  // popup points here at the DazToHue-Scripts installer (`?tab=daztohue`).
  validateSearch: (search: Record<string, unknown>): { tab?: string } =>
    typeof search.tab === 'string' ? { tab: search.tab } : {},
  loader: () => fetchSettings(),
  component: ToolsPage,
})

/** Parse the Genesis number from a source folder name ("_genesis 9" → 9) — mirrors
 *  the Rust `genesis_rank` so the UI can show which copy the install picks. */
function genesisRank(source: string): number {
  const nums = source.match(/\d+/g)
  return nums ? Number(nums[nums.length - 1]) : 0
}
/** The copy the install keeps for a shared file: newer Genesis, then bigger. */
function conflictWinner(copies: Array<ConflictCopy>): ConflictCopy {
  return copies.reduce((best, cp) => {
    const better =
      genesisRank(cp.source) > genesisRank(best.source) ||
      (genesisRank(cp.source) === genesisRank(best.source) && cp.size > best.size)
    return better ? cp : best
  })
}

/** Result of the dedup scan/apply: shared files + duplicate assets. Shared files
 *  are read-only here — the install auto-resolves them (newer genesis, then bigger);
 *  duplicate/version groups are the only thing Apply acts on (quarantine). */
function DedupReportList({
  report,
  keeperOverrides,
  onChooseKeeper,
  onClose,
}: {
  report: DedupReport
  keeperOverrides: Set<string>
  onChooseKeeper: (groupLabels: Array<string>, keep: string) => void
  onClose?: () => void
}) {
  const clean = report.conflicts.length === 0 && report.duplicates.length === 0

  // Collapse shared files by the set of products that ship them — e.g. 8 shared
  // Headlights textures become one "A ↔ B" group.
  const byProducts = new Map<string, { labels: Array<string>; items: Array<FileConflict> }>()
  for (const c of report.conflicts) {
    const labels = c.copies.map((cp) => cp.label).sort()
    const key = labels.join(' | ')
    const g = byProducts.get(key) ?? { labels, items: [] }
    g.items.push(c)
    byProducts.set(key, g)
  }
  const groups = [...byProducts.values()].sort((a, b) => b.items.length - a.items.length)

  return (
    <div className="space-y-4 border-t pt-2 text-sm">
      <ReportClose onClose={onClose} />
      {clean && <p className="text-muted-foreground">No duplicate assets or shared files found.</p>}

      {report.duplicates.length > 0 && (
        <div>
          <p className="mb-1 flex w-fit items-center gap-1 font-medium">
            Duplicate &amp; version assets ({report.duplicates.length})
            <InfoPopup label="Duplicate & version assets — more information">
              Each group is the same content found more than once — an{' '}
              <strong>exact duplicate</strong> (a folder and its identical .zip) or the{' '}
              <strong>same product at a different version</strong> (high file overlap with differing
              sizes, e.g. a <code>…UD</code> vs <code>…UPDATE</code>, marked “version”).{' '}
              <strong>Pick which copy to keep</strong> (the radio) — the rest are moved to the
              quarantine folder on Apply. The chip shows which asset folder (e.g.{' '}
              <code>_genesis 9</code>) the group lives in.
            </InfoPopup>
          </p>
          <ul className="space-y-2">
            {report.duplicates.map((d) => {
              const labels = d.members.map((m) => m.label)
              const sources = [...new Set(d.members.map((m) => m.source))].join(', ')
              const keeperLabel =
                d.members.find((m) => keeperOverrides.has(m.label))?.label ??
                d.members.find((m) => m.isKeeper)?.label
              return (
                <li key={labels.join('|')} className="rounded-md border bg-background/40 p-2">
                  <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1 py-0.5 text-[10px]">{sources}</span>
                    {d.kind === 'version' && (
                      <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-500">
                        same product, different version
                      </span>
                    )}
                  </div>
                  <ul>
                    {d.members.map((m) => {
                      const isKeep = m.label === keeperLabel
                      return (
                        <li key={m.label}>
                          <button
                            type="button"
                            disabled={!report.dryRun || isKeep}
                            onClick={() => onChooseKeeper(labels, m.label)}
                            className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left ${isKeep ? '' : 'hover:bg-muted/60'} disabled:cursor-default`}
                          >
                            <span
                              className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border ${isKeep ? 'border-emerald-500' : 'border-muted-foreground/40'}`}
                            >
                              {isKeep && <span className="size-1.5 rounded-full bg-emerald-500" />}
                            </span>
                            <span className={`break-all ${isKeep ? 'font-medium' : 'text-muted-foreground'}`}>
                              {m.label}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              · {m.fileCount} files{m.isZip ? ' · zip' : ''}
                              {isKeep
                                ? ' · keep'
                                : report.dryRun
                                  ? ' · quarantine'
                                  : d.fixed
                                    ? ' · quarantined'
                                    : ''}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {groups.length > 0 && (
        <div>
          <p className="mb-1 flex w-fit items-center gap-1 font-medium">
            Shared files ({report.conflicts.length} across {groups.length} product group
            {groups.length === 1 ? '' : 's'})
            <InfoPopup label="Shared files — more information">
              Files shipped by two different products at different sizes. The install resolves these
              automatically — <strong>newer Genesis wins</strong>, then the <strong>bigger</strong>{' '}
              file — installs the winner and leaves the rest, so they never show as “to copy”.
              Nothing to do here; this just shows what gets picked (<span className="text-emerald-600 dark:text-emerald-500">◀ keeps</span>).
            </InfoPopup>
          </p>
          <ul className="space-y-2">
            {groups.map((g) => {
              const sourceOf = new Map<string, string>()
              for (const c of g.items) for (const cp of c.copies) sourceOf.set(cp.label, cp.source)
              return (
                <li key={g.labels.join('|')} className="rounded-md border bg-background/40 p-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium break-all">
                      {g.labels.map((l, idx) => (
                        <span key={l}>
                          {idx > 0 && <span className="text-muted-foreground"> ↔ </span>}
                          {l}
                          <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
                            {sourceOf.get(l)}
                          </span>
                        </span>
                      ))}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {g.items.length} shared file{g.items.length === 1 ? '' : 's'} differ
                    </span>
                  </div>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground select-none">
                      Show files
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {g.items.map((c) => {
                        const winner = conflictWinner(c.copies)
                        return (
                          <li key={c.rel} className="font-mono text-xs break-all">
                            {c.rel}
                            <span className="font-sans text-muted-foreground">
                              {' '}—{' '}
                              {c.copies.map((cp, k) => (
                                <span key={cp.label}>
                                  {k > 0 && ' vs '}
                                  {cp.size}B{cp.inZip ? ' (zip)' : ''}
                                  {cp === winner && (
                                    <span className="text-emerald-600 dark:text-emerald-500">
                                      {' '}◀ keeps
                                    </span>
                                  )}
                                </span>
                              ))}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </details>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {!report.dryRun && (
        <p className="text-xs text-muted-foreground">
          Quarantined {report.assetsQuarantined} asset(s) — moved to{' '}
          <PathCode path={displayPath(report.backupDir)} />. Your downloaded files were not edited.
          Re-scan to confirm, then delete that folder when satisfied.
        </p>
      )}
    </div>
  )
}

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
  // Housekeeping — product-scan sweep + quarantine size/empty.
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [quarantine, setQuarantine] = useState<{ files: number; bytes: number } | null>(null)
  const [emptyConfirm, setEmptyConfirm] = useState(false)
  async function loadQuarantineStats() {
    const stats = await quarantineStats()
    setQuarantine(stats.exists ? { files: stats.files, bytes: stats.bytes } : null)
  }
  async function onCleanupNow() {
    setCleanupBusy(true)
    try {
      const result = await housekeepingSweep()
      toast.success(
        result.filesDeleted > 0
          ? `Freed ${formatBytes(result.bytesFreed)} — removed ${result.filesDeleted} stale file(s)`
          : 'Nothing to clean up — no stale scans or unused note media',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setCleanupBusy(false)
    }
  }
  async function onEmptyQuarantine() {
    setEmptyConfirm(false)
    setCleanupBusy(true)
    try {
      const result = await emptyQuarantine()
      toast.success(`Emptied quarantine — freed ${formatBytes(result.bytesFreed)}`)
      await loadQuarantineStats()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setCleanupBusy(false)
    }
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
  function addAssetFolder() {
    setAssetFolders([...settings.dazAssetsFolders, ''])
  }
  function updateAssetFolder(i: number, value: string) {
    setAssetFolders(settings.dazAssetsFolders.map((f, j) => (j === i ? value : f)))
  }
  function removeAssetFolder(i: number) {
    setAssetFolders(settings.dazAssetsFolders.filter((_, j) => j !== i))
  }
  async function browseAssetFolder(i: number) {
    const picked = await pickFolder('Daz assets folder')
    if (picked) updateAssetFolder(i, picked)
  }

  // --- "Danger zone": Daz uninstall cleanup folder list ---
  function setUninstallFolders(folders: Array<string>) {
    setSettings((s) => ({ ...s, dazUninstallFolders: folders }))
    setUninstallReport(null)
    setUninstallConfirm(false)
  }
  function updateUninstallFolder(i: number, value: string) {
    setUninstallFolders(settings.dazUninstallFolders.map((f, j) => (j === i ? value : f)))
  }
  function addUninstallFolder() {
    setUninstallFolders([...settings.dazUninstallFolders, ''])
  }
  function removeUninstallFolder(i: number) {
    setUninstallFolders(settings.dazUninstallFolders.filter((_, j) => j !== i))
  }
  async function browseUninstallFolder(i: number) {
    const picked = await pickFolder('Folder to delete on uninstall')
    if (picked) updateUninstallFolder(i, picked)
  }
  // "Prefill folder paths" — add the standard Daz locations, merged with whatever's
  // already in the list. Not filtered by existence; missing ones are simply reported
  // as "not found" when deleting.
  async function prefillUninstallFolders() {
    try {
      const found = await defaultDazUninstallFolders()
      const existing = settings.dazUninstallFolders.map((f) => f.trim()).filter(Boolean)
      const merged = [...existing]
      for (const f of found) if (!merged.includes(f)) merged.push(f)
      setUninstallFolders(merged)
      toast.success(
        merged.length > existing.length
          ? `Added ${merged.length - existing.length} folder(s)`
          : 'Standard Daz folders already in the list',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
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

          <section className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="font-semibold">Daz assets</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your own asset source folders (Genesis 3/8/9; <span className="font-mono">.zip</span>s
                are extracted). Each asset's content (<span className="font-mono">data</span>/
                <span className="font-mono">People</span>/<span className="font-mono">Runtime</span>/
                <span className="font-mono">Documentation</span>) installs into “My DAZ 3D Library”,
                skipping ones already there.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                When two products share a file, the winner is chosen automatically:{' '}
                <strong>newer Genesis wins</strong> (by folder name, e.g. <code>_genesis 9</code> over{' '}
                <code>_genesis 8</code>), then the <strong>bigger file</strong> wins — so only the
                winning copy installs and the losers are never re-flagged. Folder order doesn't matter.
              </p>
            </div>
            <div className="space-y-2">
              {settings.dazAssetsFolders.length === 0 && (
                <p className="text-sm text-muted-foreground">No asset folders yet.</p>
              )}
              {settings.dazAssetsFolders.map((folder, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={displayPath(folder)}
                    placeholder="D:\…\daz assets"
                    onChange={(e) => updateAssetFolder(i, e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => void browseAssetFolder(i)}
                  >
                    <FolderOpen /> Browse
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    title="Remove folder"
                    onClick={() => removeAssetFolder(i)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addAssetFolder}>
                <Plus /> Add folder
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void runScan()} disabled={assetsBusy}>
                {assetsBusy ? 'Working…' : 'Scan'}
              </Button>
              <Button
                variant="outline"
                onClick={() => runInstall(installDazAssets, true, setAssetsBusy, setAssetsReport)}
                disabled={assetsBusy}
              >
                Dry run
              </Button>
              <Button
                onClick={() =>
                  runInstall(
                    ({ data }) =>
                      installDazAssets({ data: { ...data, only: changedAssets } }),
                    false,
                    setAssetsBusy,
                    setAssetsReport,
                  )
                }
                disabled={assetsBusy}
                title={
                  changedAssets.length
                    ? 'Installs only the assets the last scan/dry-run flagged as changed'
                    : undefined
                }
              >
                <Download />{' '}
                {changedAssets.length ? `Install ${changedAssets.length} changed` : 'Install assets'}
              </Button>
            </div>
            {assetsReport && (
              <InstallReportList report={assetsReport} onClose={() => setAssetsReport(null)} />
            )}
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="flex w-fit items-center gap-1 font-semibold">
                Deduplicate
                <InfoPopup label="Deduplicate — more information">
                  Finds <strong>duplicate assets</strong> (a folder and its identical .zip, or the
                  same product at two versions) and <strong>conflicting shared files</strong> — the
                  same file shipped by two different products at different sizes (e.g. the G8 and G9
                  versions of a product sharing textures), which makes both perpetually show “to
                  copy”. <strong>Apply</strong> only <strong>quarantines</strong> the redundant
                  duplicate copies (a move — reversible). Shared-file conflicts are{' '}
                  <strong>never rewritten</strong> — that would edit an author's downloaded asset;
                  instead you <strong>Accept</strong> them, which tells the scan/install they're
                  legitimately shared (whatever's installed stays).
                </InfoPopup>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Scan first to preview; nothing is changed until you Apply.
              </p>
            </div>
            <FolderField
              label="Quarantine folder"
              value={settings.dedupQuarantineFolder}
              placeholder="D:\…\_quarantine"
              info={
                <>
                  Where Apply moves the redundant duplicate copies. Required to run Apply — nothing is
                  moved until it's set. Pick a folder <strong>outside</strong> your asset source
                  folders (so it isn't re-scanned); same drive is fastest. The move is reversible.
                </>
              }
              help={<>Where redundant duplicate copies are moved.</>}
              onChange={(value) => setSettings((s) => ({ ...s, dedupQuarantineFolder: value }))}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void runDedup(true)} disabled={dedupBusy}>
                {dedupBusy ? 'Working…' : 'Scan for duplicates'}
              </Button>
              <Button
                variant="destructive"
                onClick={() => void runDedup(false)}
                disabled={
                  dedupBusy ||
                  !dedupReport?.dryRun ||
                  dedupReport.duplicates.length === 0 ||
                  !settings.dedupQuarantineFolder.trim()
                }
                title={
                  settings.dedupQuarantineFolder.trim()
                    ? 'Move the redundant duplicate copies to the quarantine folder (reversible; files are never edited)'
                    : 'Set a quarantine folder first'
                }
              >
                Apply dedup
              </Button>
              {dedupReport?.duplicates.length && !settings.dedupQuarantineFolder.trim() ? (
                <span className="self-center text-xs text-muted-foreground">
                  Set a quarantine folder to enable Apply.
                </span>
              ) : null}
            </div>
            {dedupReport && (
              <DedupReportList
                report={dedupReport}
                keeperOverrides={keeperOverrides}
                onChooseKeeper={chooseKeeper}
                onClose={() => setDedupReport(null)}
              />
            )}
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="flex w-fit items-center gap-1 font-semibold">
                Storage &amp; housekeeping
                <InfoPopup label="Storage & housekeeping — more information">
                  The studio ages out its own generated data so it can't fill your disk.
                  Per-scene <strong>product-scan</strong> files are deleted automatically once
                  they're older than <strong>{PRODUCT_SCAN_RETENTION_DAYS} days</strong> (also on
                  every launch); deleting a character removes its scan data right away. Dropped{' '}
                  <strong>note media</strong> no notes reference anymore is removed after{' '}
                  <strong>{NOTE_MEDIA_RETENTION_DAYS} days</strong> (saving notes already cleans up
                  after an hour). The dedup <strong>quarantine</strong> is your reversible backup,
                  so it's only ever emptied when you ask.
                </InfoPopup>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reclaim space from the studio's own generated data.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => void onCleanupNow()} disabled={cleanupBusy}>
                <Trash2 /> {cleanupBusy ? 'Working…' : 'Clean up now'}
              </Button>
              <span className="text-sm text-muted-foreground">
                Age out product-scan files older than {PRODUCT_SCAN_RETENTION_DAYS} days and
                unreferenced note media older than {NOTE_MEDIA_RETENTION_DAYS} days.
              </span>
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-medium">Dedup quarantine</p>
              {settings.dedupQuarantineFolder.trim() ? (
                quarantine && quarantine.files > 0 ? (
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      {formatBytes(quarantine.bytes)} in {quarantine.files} file(s) at{' '}
                      <PathCode path={displayPath(settings.dedupQuarantineFolder)} />
                    </span>
                    {emptyConfirm ? (
                      <span className="flex items-center gap-2">
                        <span className="text-sm">Permanently delete the quarantined copies?</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => void onEmptyQuarantine()}
                          disabled={cleanupBusy}
                        >
                          Yes, empty it
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEmptyConfirm(false)}>
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEmptyConfirm(true)}
                        disabled={cleanupBusy}
                      >
                        <Trash2 /> Empty quarantine
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">Empty — nothing to reclaim.</p>
                )
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  No quarantine folder set (see Deduplicate above).
                </p>
              )}
            </div>
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="font-semibold">Custom morphs</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Morphs you made with Daz's Transfer Shape Utility. Merge-only — adds new files,
                never overwrites your edits.
              </p>
            </div>
            <FolderField
              label="Morphs source"
              value={settings.dazMorphsSource}
              placeholder="D:\…\_morphs"
              help={<>Your custom-morphs source folder.</>}
              onChange={(value) => setSettings((s) => ({ ...s, dazMorphsSource: value }))}
            />
            <FolderField
              label="Morphs destination"
              value={settings.dazMorphsDest}
              placeholder="C:\Users\you\Documents\DAZ 3D\Studio\My Library\data\Daz 3D"
              help={
                <>
                  Your personal library's <span className="font-mono">data/Daz 3D</span> folder.
                </>
              }
              onChange={(value) => setSettings((s) => ({ ...s, dazMorphsDest: value }))}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => runInstall(installDazMorphs, true, setMorphsBusy, setMorphsReport)}
                disabled={morphsBusy}
              >
                Dry run
              </Button>
              <Button
                onClick={() => runInstall(installDazMorphs, false, setMorphsBusy, setMorphsReport)}
                disabled={morphsBusy}
              >
                <Download /> Install morphs
              </Button>
            </div>
            {morphsReport && (
              <InstallReportList report={morphsReport} onClose={() => setMorphsReport(null)} />
            )}
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="font-semibold">Daz presets</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your Daz presets. Merge-only — adds new files, never overwrites.
              </p>
            </div>
            <FolderField
              label="Presets source"
              value={settings.dazPresetsSource}
              placeholder="D:\…\_presets"
              help={<>Your presets source folder.</>}
              onChange={(value) => setSettings((s) => ({ ...s, dazPresetsSource: value }))}
            />
            <FolderField
              label="Presets destination"
              value={settings.dazPresetsDest}
              placeholder="C:\Users\you\Documents\DAZ 3D\Studio\My Library\Presets"
              help={
                <>
                  Your personal library's <span className="font-mono">Presets</span> folder.
                </>
              }
              onChange={(value) => setSettings((s) => ({ ...s, dazPresetsDest: value }))}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => runInstall(installDazPresets, true, setPresetsBusy, setPresetsReport)}
                disabled={presetsBusy}
              >
                Dry run
              </Button>
              <Button
                onClick={() => runInstall(installDazPresets, false, setPresetsBusy, setPresetsReport)}
                disabled={presetsBusy}
              >
                <Download /> Install presets
              </Button>
            </div>
            {presetsReport && (
              <InstallReportList report={presetsReport} onClose={() => setPresetsReport(null)} />
            )}
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="font-semibold">Houdini presets</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your Houdini <span className="font-mono">my_presets</span>. Merges into the folder in
                your Houdini documents folder (set in the DazToHue tab) — adds/updates files without
                deleting the folder first — and wires it into{' '}
                <span className="font-mono">houdini.env</span> (SHARED_PRESETS + HOUDINI_PATH).
              </p>
            </div>
            <FolderField
              label="Houdini presets source"
              value={settings.houdiniPresetsSource}
              placeholder="D:\…\houdini\my_presets"
              help={<>Your Houdini presets source folder.</>}
              onChange={(value) => setSettings((s) => ({ ...s, houdiniPresetsSource: value }))}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => runInstall(installHoudiniPresets, true, setHoudiniBusy, setHoudiniReport)}
                disabled={houdiniBusy}
              >
                Dry run
              </Button>
              <Button
                onClick={() => runInstall(installHoudiniPresets, false, setHoudiniBusy, setHoudiniReport)}
                disabled={houdiniBusy}
              >
                <Download /> Install Houdini presets
              </Button>
            </div>
            {houdiniReport && (
              <InstallReportList report={houdiniReport} onClose={() => setHoudiniReport(null)} />
            )}
          </section>

          <section className="space-y-4 rounded-lg border border-destructive/40 bg-card p-5">
            <div>
              <h2 className="flex w-fit items-center gap-1 font-semibold text-destructive">
                Danger zone
                <InfoPopup label="Danger zone — more information">
                  After uninstalling Daz Studio and DAZ Install Manager through Windows “Add or remove
                  programs”, these leftover folders usually remain. This button{' '}
                  <strong>permanently deletes</strong> each listed folder and everything inside it
                  (recursively). Use <strong>Prefill folder paths</strong> to add the standard Daz
                  locations, edit the list as needed, then always Dry run first. Folders that don't
                  exist are skipped when deleting.
                </InfoPopup>
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Clean up leftover Daz folders after removing Daz via Windows “Add or remove programs”.{' '}
                <br />
                <strong className="text-destructive">
                  Each folder below is permanently deleted with everything in it.
                </strong>
              </p>
            </div>
            <div className="space-y-2">
              {settings.dazUninstallFolders.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No folders yet
                </p>
              )}
              {settings.dazUninstallFolders.map((folder, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={displayPath(folder)}
                    placeholder="D:\…\DAZ 3D"
                    onChange={(e) => updateUninstallFolder(i, e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => void browseUninstallFolder(i)}
                  >
                    <FolderOpen /> Browse
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    title="Remove folder"
                    onClick={() => removeUninstallFolder(i)}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addUninstallFolder}>
                  <Plus /> Add folder
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void prefillUninstallFolders()}
                >
                  Prefill folder paths
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => void runUninstall(true)} disabled={uninstallBusy}>
                {uninstallBusy ? 'Working…' : 'Dry run'}
              </Button>
              {uninstallConfirm ? (
                <>
                  <span className="text-sm font-medium text-destructive">
                    Permanently delete {settings.dazUninstallFolders.filter((f) => f.trim()).length}{' '}
                    folder(s) and all their contents?
                  </span>
                  <Button
                    variant="destructive"
                    onClick={() => void runUninstall(false)}
                    disabled={uninstallBusy}
                  >
                    Yes, delete
                  </Button>
                  <Button variant="outline" onClick={() => setUninstallConfirm(false)} disabled={uninstallBusy}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="destructive"
                  onClick={() => setUninstallConfirm(true)}
                  disabled={
                    uninstallBusy || settings.dazUninstallFolders.filter((f) => f.trim()).length === 0
                  }
                >
                  <Trash2 /> Uninstall Daz
                </Button>
              )}
            </div>
            {uninstallReport && (
              <InstallReportList report={uninstallReport} onClose={() => setUninstallReport(null)} />
            )}
          </section>
        </TabsContent>

        <TabsContent value="daztohue" className="space-y-5">
          <p className="text-sm text-muted-foreground">
            Install the companion{' '}
            <a
              href={DAZTOHUE_SCRIPTS_REPO}
              onClick={(e) => {
                e.preventDefault()
                void openExternal(DAZTOHUE_SCRIPTS_REPO)
              }}
              className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
            >
              DazToHue-Scripts repo <ExternalLink className="size-3.5" />
            </a>{' '}
            — the Daz Studio scripts behind DTH Character Studio. It includes{' '}
            <strong>DthScanFrames.dsa</strong>, which exports the full morph list of an existing Daz
            scene as a CSV you can import into a character's ROM section.
          </p>

          <section className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="flex w-fit items-center gap-1 font-semibold">
                DazToHue-Scripts
                <InfoPopup label="DazToHue-Scripts — more information">
                  Downloads{' '}
                  <a
                    href={DAZTOHUE_SCRIPTS_REPO}
                    className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
                  >
                    soltude/DazToHue-Scripts <ExternalLink className="size-3.5" />
                  </a>{' '}
                  and installs it into “My DAZ 3D Library”. Then, inside Daz Studio, run{' '}
                  <a
                    href={DTH_SCAN_FRAMES_URL}
                    className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
                  >
                    DthScanFrames.dsa <ExternalLink className="size-3.5" />
                  </a>{' '}
                  on an open scene to write a CSV of every morph on it — then use a section's{' '}
                  <strong>Import from CSV</strong> to pull that morph list into a character's ROM.
                </InfoPopup>
              </h2>
            </div>

            {settings.dazLibraryFolder.trim() ? (
              <p className="text-sm text-muted-foreground">
                Installs into{' '}
                <PathCode path={displayPath(daztohueScriptsDir(settings.dazLibraryFolder.trim()))} />.
              </p>
            ) : (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                “My DAZ 3D Library” isn't set — the scripts have nowhere to install. Set it in{' '}
                <Link to="/settings" className="font-medium underline underline-offset-2">
                  Settings
                </Link>{' '}
                first.
              </p>
            )}

            <ScriptsVersionStatus status={scriptsStatus} />

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => runInstall(installDazToHueScripts, true, setScriptsBusy, setScriptsReport)}
                disabled={scriptsBusy || !settings.dazLibraryFolder.trim()}
              >
                {scriptsBusy ? 'Working…' : 'Dry run'}
              </Button>
              <Button
                onClick={() =>
                  runInstall(
                    installDazToHueScripts,
                    false,
                    setScriptsBusy,
                    setScriptsReport,
                    undefined,
                    loadScriptsStatus, // re-check the installed-vs-latest commit
                  )
                }
                disabled={scriptsBusy || !settings.dazLibraryFolder.trim()}
              >
                <Download />{' '}
                {scriptsBusy
                  ? 'Installing…'
                  : scriptsStatus?.state === 'outdated'
                    ? 'Update'
                    : scriptsStatus && scriptsStatus.state !== 'notinstalled'
                      ? 'Reinstall'
                      : 'Install'}
              </Button>
            </div>
            {scriptsReport && (
              <InstallReportList report={scriptsReport} onClose={() => setScriptsReport(null)} />
            )}
          </section>
        </TabsContent>

        <TabsContent value="refresh" className="space-y-5">
          <RefreshAssetsTab />
        </TabsContent>
      </Tabs>
    </main>
  )
}

/** First 7 chars of a commit SHA — the familiar short form. */
function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

/**
 * Installed-vs-latest line for the DazToHue-Scripts install — phrased + sized to
 * match the DTH Exporter Plugin status in Settings: an emerald, check-marked
 * "Already installed (X) — up to date." when the local commit matches GitHub's HEAD,
 * an "Installed: X → updating to Y." line when a newer commit exists, and muted text
 * otherwise. Every line is `text-sm`. Hidden until the first check resolves.
 */
function ScriptsVersionStatus({ status }: { status: DazToHueScriptsStatus | null }) {
  if (!status) return null
  switch (status.state) {
    case 'uptodate':
      return (
        <p className="flex items-center gap-1.5 text-sm text-emerald-500">
          <CircleCheck className="size-4 shrink-0" />
          Already installed ({shortSha(status.installed ?? '')}) — up to date.
        </p>
      )
    case 'outdated':
      return (
        <p className="text-sm text-muted-foreground">
          Installed: <strong className="text-foreground">{shortSha(status.installed ?? '')}</strong> →
          updating to <strong className="text-foreground">{shortSha(status.latest ?? '')}</strong>.
        </p>
      )
    case 'unknown':
      return (
        <p className="text-sm text-muted-foreground">
          Installed: <strong className="text-foreground">{shortSha(status.installed ?? '')}</strong> —
          couldn't check for the latest version.
        </p>
      )
    case 'unversioned':
      return (
        <p className="text-sm text-muted-foreground">
          Installed, but its version isn't tracked yet — reinstall to record it.
        </p>
      )
    default:
      return <p className="text-sm text-muted-foreground">Not installed yet.</p>
  }
}

/**
 * "Refresh assets" tab — re-generate the Daz scripts + PoseAsset CSVs (e.g. after a
 * studio update or a DTH-release switch). Scope follows the window: the current
 * project in a project window, every known (recent) project from the Home window.
 * Shows a compact local-vs-app version table (DTH release, character schema, script
 * runtime), then offers the one-click Refresh with a per-run summary. Refresh
 * migrates stale definitions (re-stamping the schema version) and regenerates them.
 */
function RefreshAssetsTab() {
  const [report, setReport] = useState<AssetVersionReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [summary, setSummary] = useState<RefreshSummary | null>(null)

  async function reload() {
    setLoading(true)
    try {
      setReport(await detectAssetVersions())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void reload()
  }, [])

  async function onRefresh() {
    setRefreshing(true)
    setSummary(null)
    try {
      const result = await refreshAllAssets()
      setSummary(result)
      if (result.runtime && !result.runtime.ok) {
        toast.error(`Runtime refresh failed: ${result.runtime.detail ?? ''}`)
      } else if (result.total === 0) {
        toast(
          result.runtime?.ok
            ? 'DTH runtime refreshed — no characters to regenerate'
            : 'No characters to refresh yet',
        )
      } else if (result.failed > 0) {
        toast.error(`Re-generated ${result.regenerated} of ${result.total} — ${result.failed} failed`)
      } else {
        // Spell out exactly what was (re)generated, per artifact, in the toast.
        const n = (count: number, one: string, many = `${one}s`) =>
          `${count} ${count === 1 ? one : many}`
        const lines: Array<string> = []
        if (result.counts.migrated > 0)
          lines.push(`Migrated ${n(result.counts.migrated, 'character definition')}`)
        if (result.counts.scripts > 0)
          lines.push(`Re-generated Daz scripts for ${n(result.counts.scripts, 'character')}`)
        if (result.counts.csv > 0)
          lines.push(`Re-generated ${n(result.counts.csv, 'PoseAsset CSV')}`)
        if (result.runtime?.ok) lines.push('Re-installed the DTH runtime files')
        toast.success(`Refreshed ${n(result.regenerated, 'character')}`, {
          description: lines.length ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : undefined,
        })
      }
      await reload() // re-detect so the version table reflects the regeneration
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  const failures = summary?.results.filter((r) => !r.ok) ?? []
  const warnings = summary?.results.filter((r) => r.ok && r.detail) ?? []
  // Pulse the action while there's pending work (but not mid-refresh — the spinner
  // carries that state). `report` is null until the first detection finishes.
  const needsRefresh = (report?.refreshNeeded ?? false) && !refreshing

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h2 className="flex w-fit items-center gap-1 font-semibold">
          Refresh assets
          <InfoPopup label="Refresh assets — more information">
            Re-generates the Daz scripts and PoseAsset CSVs so all generated files match the current
            version — run this after updating the studio or switching DTH release. It always covers
            every known (recent) project, no matter which window it runs from. Character definitions
            aren't changed.
          </InfoPopup>
        </h2>
        {/* The action sits up top so it's visible at a glance, above the table; it's
            enlarged and pulses a light orange while a refresh is pending. */}
        <Button
          size="lg"
          variant="outline"
          onClick={() => void onRefresh()}
          disabled={refreshing}
          className={`h-11 px-6 text-base ${needsRefresh ? 'refresh-pulse' : ''}`}
        >
          <RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : 'Refresh assets'}
        </Button>
        {/* The success summary is a toast now; only per-character problems stay on
            the page (they're detailed and worth keeping visible). */}
        {(failures.length > 0 || warnings.length > 0) && (
          <div className="space-y-2 text-sm">
            {failures.map((r, i) => (
              <p key={`f${i}`} className="flex items-start gap-2 text-destructive">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-medium">
                    {r.project} · {r.character}
                  </span>
                  {r.detail && <span className="text-muted-foreground"> — {r.detail}</span>}
                </span>
              </p>
            ))}
            {warnings.map((r, i) => (
              <p key={`w${i}`} className="flex items-start gap-2 text-muted-foreground">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-medium">
                    {r.project} · {r.character}
                  </span>{' '}
                  — {r.detail}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="border-t pt-5">
        {loading ? (
          <p className="text-sm text-muted-foreground">Checking local versions…</p>
        ) : report ? (
          <RefreshDetection report={report} />
        ) : null}
      </div>
    </div>
  )
}

/** One row of the local-vs-app version table. `state` drives the colour + icon:
 *  matched (green/check), differing (red value + yellow warning), or not comparable
 *  (muted "—" — no DAZ library, or no DTH release to compare against). */
type VersionRowState = 'match' | 'mismatch' | 'unchecked'
interface VersionRow {
  label: string
  local: string
  app: string
  state: VersionRowState
  /** Popup copy explaining which generated files this version governs. */
  info: ReactNode
}

/** The version-detection block: a compact local-vs-app table over the three version
 *  dimensions (DTH release, character schema, script runtime). A row is green +
 *  checkmark when the local value(s) match what the app generates, red + a yellow
 *  warning when they differ, or muted when it can't be checked. "Local" usually holds
 *  one value per row, but lists several when characters sit at different versions. */
function RefreshDetection({ report }: { report: AssetVersionReport }) {
  const { app, characters, hasDazLibrary, hasDthRelease } = report
  const hasChars = characters.length > 0

  // Distinct local values per dimension — normally one each; more than one only when
  // characters were generated/saved at differing versions (some not yet refreshed).
  const schemaLocals = [...new Set(characters.map((c) => c.schemaVersion))].sort((a, b) => a - b)
  const runtimeLocals = [...new Set(characters.map((c) => c.runtimeVersion))].sort(
    (a, b) => (a ?? -1) - (b ?? -1),
  )
  const releaseLocals = [...new Set(characters.map((c) => c.generatedDthVersion))].sort((a, b) =>
    a.localeCompare(b),
  )

  // A row matches only when there's exactly one local value and it equals the app's.
  const matches = (locals: ReadonlyArray<unknown>, appValue: unknown) =>
    locals.length === 1 && locals[0] === appValue
  const schemaState: VersionRowState = !hasChars
    ? 'unchecked'
    : matches(schemaLocals, app.schema)
      ? 'match'
      : 'mismatch'
  const runtimeState: VersionRowState =
    !hasDazLibrary || !hasChars
      ? 'unchecked'
      : matches(runtimeLocals, app.runtime)
        ? 'match'
        : 'mismatch'
  // The CSV is tied to the DTH *era* (a breaking-release boundary), not the exact
  // release — two releases in the same era are interchangeable. Compare eras, and
  // (unlike runtime) this needs no DAZ library: the CSV + its provenance are local.
  const appEra = poseAssetCsvEra(app.dthRelease)
  const localEras = [...new Set(characters.map((c) => poseAssetCsvEra(c.generatedDthVersion)))]
  const releaseState: VersionRowState =
    !hasDthRelease || !hasChars
      ? 'unchecked'
      : localEras.length === 1 && localEras[0] === appEra
        ? 'match'
        : 'mismatch'

  const rows: Array<VersionRow> = [
    {
      label: 'DTH Version',
      local:
        releaseState === 'unchecked'
          ? '—'
          : releaseLocals.map((r) => (r === '' ? 'not generated' : `v${r}`)).join(', '),
      app: hasDthRelease ? `v${app.dthRelease}` : 'none',
      state: releaseState,
      info: (
        <>
          Governs the Houdini <strong>PoseAsset CSV</strong> (<em>…_pose_asset.csv</em>) — the only
          artifact tied to the DTH release. It's pinned to the release's CSV <em>era</em>, so a
          non-breaking release (e.g. 2.4.3 → 2.4.4) stays current; only a release that changes the
          CSV format marks it out of date. Out of date → the CSV is regenerated.
        </>
      ),
    },
    {
      label: 'Character Schema Version',
      local: schemaState === 'unchecked' ? '—' : schemaLocals.map((n) => `v${n}`).join(', '),
      app: `v${app.schema}`,
      state: schemaState,
      info: (
        <>
          Governs the <strong>character definition</strong> (its <em>.json</em>). A newer version
          means the stored shape changed: the definition is migrated and re-saved — and, since a
          migration can change generated output, its Daz scripts and PoseAsset CSV are regenerated
          too.
        </>
      ),
    },
    {
      label: 'Script Runtime Version',
      local:
        runtimeState === 'unchecked'
          ? '—'
          : runtimeLocals.map((n) => (n === null ? 'not generated' : `v${n}`)).join(', '),
      app: `v${app.runtime}`,
      state: runtimeState,
      info: (
        <>
          Governs the generated <strong>Daz scripts</strong> (the ROM / Export <em>.dsa</em>) and the
          shared <strong>DTH runtime files</strong>. A newer version means the runtime's call API
          changed, so the runtime files are reinstalled and every character's scripts regenerated.
        </>
      ),
    },
  ]

  const valueClass = (state: VersionRowState) =>
    state === 'match'
      ? 'text-emerald-600 dark:text-emerald-500'
      : state === 'mismatch'
        ? 'text-red-600 dark:text-red-500'
        : 'text-muted-foreground'

  return (
    <div className="space-y-3">
      {report.total === 0 ? (
        <p className="text-sm text-muted-foreground">No characters to check yet.</p>
      ) : report.refreshNeeded ? (
        <div className="flex items-start gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            <strong>Refresh needed</strong> — {report.staleCount} of {report.total} character
            {report.total === 1 ? '' : 's'} are out of date. Refresh migrates and regenerates them.
          </span>
        </div>
      ) : null}

      <table className="w-full max-w-md overflow-hidden rounded-lg border text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs tracking-wide text-muted-foreground uppercase">
            <th className="px-3 py-2 font-medium"></th>
            <th className="px-3 py-2 font-medium">Local</th>
            <th className="px-3 py-2 font-medium">App</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => (
            <tr key={row.label}>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-0.5">
                  {row.label}
                  <InfoPopup label={`${row.label} — what it affects`}>{row.info}</InfoPopup>
                </span>
              </th>
              <td className="px-3 py-2">
                <span className={`inline-flex items-center gap-1.5 font-medium ${valueClass(row.state)}`}>
                  {row.state === 'match' && <CircleCheck className="size-4 shrink-0" />}
                  {row.state === 'mismatch' && (
                    <TriangleAlert className="size-4 shrink-0 text-amber-500" />
                  )}
                  {row.local}
                </span>
              </td>
              <td className="px-3 py-2">
                {/* App is the reference value — always neutral; only Local is coloured. */}
                <span className="font-medium text-foreground">{row.app}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!report.hasDazLibrary ? (
        <p className="text-xs text-muted-foreground">
          No <strong className="text-foreground">My DAZ 3D Library</strong> is set, so generated-script
          versions (runtime / DTH release) can't be checked — set it in{' '}
          <Link to="/settings" className="font-medium text-primary underline underline-offset-2">
            Settings
          </Link>{' '}
          to refresh scripts too. Definition migrations don't need it.
        </p>
      ) : (
        !report.hasDthRelease && (
          <p className="text-xs text-muted-foreground">
            No DTH release is configured, so the release version can't be checked — set one in{' '}
            <Link to="/settings" className="font-medium text-primary underline underline-offset-2">
              Settings
            </Link>
            .
          </p>
        )
      )}
    </div>
  )
}
