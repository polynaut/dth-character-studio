import { useCallback, useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CircleCheck, Download } from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'
import { FormHeader } from '#/components/form-header.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { Field } from '#/components/field.tsx'
import { InfoPopup } from '#/components/ui/info-popup.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import {
  detectDimManifestsFolder,
  ensureNetworkDrives,
  fetchActiveProject,
  fetchAppDataFolder,
  fetchKnownDrives,
  fetchSettings,
  forgetNetworkDrive,
  installDthPlugin,
  installDthRelease,
  installedExporterVersion,
  listDthExporterReleases,
  listDthReleases,
  rescanPoseAssets,
  saveProjectSettings,
  saveSettings,
  uncForPath,
} from '#/lib/rom/api.ts'
import { confirmDialog } from '#/lib/desktop.ts'
import { useUnsavedChangesGuard } from '#/lib/use-unsaved-guard.ts'
import { displayPath } from '#/lib/path.ts'
import { cn } from '#/lib/utils.ts'
import { PathCode } from '#/components/path-code.tsx'
import { FolderField, InstallReportList } from '#/components/install-controls.tsx'
import { toast } from 'sonner'

import type {
  DthExporterReleaseInfo,
  DthReleaseInfo,
  InstallReport,
} from '#/lib/rom/api.ts'

export const Route = createFileRoute('/settings')({
  // Settings is reachable from several places; an optional `from` label lets the
  // entry point name the back link (the navigation itself just pops history).
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({
    from: typeof search.from === 'string' ? search.from : undefined,
  }),
  // Machine settings + (when this window is on a project) that project's record, so
  // the Project tab can edit the per-project `.dcsp` defaults.
  loader: async () => ({ settings: await fetchSettings(), project: await fetchActiveProject() }),
  component: SettingsPage,
})

interface ReleasesState {
  mode: 'single' | 'multi' | 'none'
  version: string
  releases: Array<DthReleaseInfo>
  error: string | null
}

interface ExporterReleasesState {
  mode: 'single' | 'multi' | 'none'
  version: string
  releases: Array<DthExporterReleaseInfo>
  error: string | null
}

/**
 * Under the DTH folder field: nothing for an empty folder, the detected version
 * for a single release, or a version dropdown when the folder holds several.
 */
function ReleasePicker({
  releases,
  loading,
  value,
  onChange,
}: {
  releases: ReleasesState
  loading: boolean
  value: string
  onChange: (version: string) => void
}) {
  if (loading) {
    return <p className="mt-2 text-xs text-muted-foreground">Looking for DTH releases…</p>
  }
  if (releases.error) {
    return <p className="mt-2 text-sm text-destructive">{releases.error}</p>
  }
  if (releases.mode === 'single') {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Single release detected
        {releases.version && (
          <>
            {' '}— version <strong className="text-foreground">{releases.version}</strong>
          </>
        )}
        .
      </p>
    )
  }
  if (releases.mode === 'multi') {
    const selected = releases.releases.find((r) => r.version === value)
    return (
      <div className="mt-3">
        <Label className="mb-1">DTH release version</Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select a version" />
          </SelectTrigger>
          <SelectContent>
            {releases.releases.map((r) => (
              <SelectItem key={r.version} value={r.version}>
                {r.version}
                {r.kind === 'zip' ? ' — zip (extract first)' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected?.kind === 'zip' ? (
          <div className="mt-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Extract the release zip first and select folders only.
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {releases.releases.length} release{releases.releases.length === 1 ? '' : 's'} found. New
            releases don't switch automatically — pick one and Save.
          </p>
        )}
      </div>
    )
  }
  return null
}

/**
 * Under the Exporter Plugin folder field — mirrors {@link ReleasePicker}: the
 * detected version for a single plugin folder, or a version dropdown when the
 * folder holds several. The version is read from the exporter DLL.
 */
function ExporterReleasePicker({
  releases,
  loading,
  value,
  onChange,
}: {
  releases: ExporterReleasesState
  loading: boolean
  value: string
  onChange: (version: string) => void
}) {
  if (loading) {
    return <p className="mt-2 text-xs text-muted-foreground">Looking for the DTH Exporter Plugin…</p>
  }
  if (releases.error) {
    return <p className="mt-2 text-sm text-destructive">{releases.error}</p>
  }
  if (releases.mode === 'single') {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Plugin detected
        {releases.version ? (
          <>
            {' '}— version <strong className="text-foreground">{releases.version}</strong>
          </>
        ) : (
          <> — no version info in the exporter DLL</>
        )}
        .
      </p>
    )
  }
  if (releases.mode === 'multi') {
    return (
      <div className="mt-3">
        <Label className="mb-1">Exporter Plugin version</Label>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select a version" />
          </SelectTrigger>
          <SelectContent>
            {releases.releases.map((r) => (
              <SelectItem key={r.version} value={r.version}>
                {r.version}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          {releases.releases.length} plugin version{releases.releases.length === 1 ? '' : 's'} found.
          New ones don't switch automatically — pick one and Save.
        </p>
      </div>
    )
  }
  return null
}

/**
 * Lists the network drives the app has remembered (X: → \\host\share) with their
 * current mapped status, a "Forget" per drive, and a manual re-map. Drives are
 * remembered automatically as paths are picked and re-mapped on startup.
 */
function NetworkDrivesSection() {
  const [drives, setDrives] = useState<Array<{ drive: string; unc: string; mapped: boolean }>>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const known = await fetchKnownDrives()
    const withStatus = await Promise.all(
      known.map(async (d) => ({ ...d, mapped: (await uncForPath(d.drive)) !== '' })),
    )
    setDrives(withStatus)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (drives.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Network drives are remembered automatically as you pick paths, then re-mapped on startup —
        so the app keeps working after you relaunch it as administrator (when Windows hides your
        mappings from the elevated session).
      </p>
    )
  }

  async function remap() {
    setBusy(true)
    try {
      const results = await ensureNetworkDrives()
      const failed = results.filter((r) => r.status === 'failed')
      const remapped = results.filter((r) => r.status === 'remapped').length
      if (failed.length > 0) toast.error(`${failed.length} drive(s) failed to map`)
      else toast.success(remapped > 0 ? `Re-mapped ${remapped} drive(s)` : 'All drives already mapped')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function forget(drive: string) {
    await forgetNetworkDrive({ data: { drive } })
    await load()
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2 text-sm">
        {drives.map((d) => (
          <li key={d.drive} className="flex items-center gap-2">
            <span
              className={cn('size-2 shrink-0 rounded-full', d.mapped ? 'bg-emerald-500' : 'bg-muted-foreground/40')}
              title={d.mapped ? 'Mapped' : 'Not mapped'}
            />
            <span className="font-mono">{d.drive}</span>
            <span className="text-muted-foreground">→</span>
            <span className="truncate font-mono text-muted-foreground">{d.unc}</span>
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto shrink-0"
              onClick={() => void forget(d.drive)}
            >
              Forget
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" onClick={() => void remap()} disabled={busy}>
        {busy ? 'Mapping…' : 'Re-map missing now'}
      </Button>
    </div>
  )
}

function SettingsPage() {
  const { settings: initial, project } = Route.useLoaderData()
  const router = useRouter()
  const { from } = Route.useSearch()
  const backLabel = from ? `Back to ${from}` : 'Back'

  // Reachable from several places, so return to wherever we came from (falling
  // back to the projects home if there's no history to pop) — like the About page.
  function goBack() {
    if (router.history.canGoBack()) router.history.back()
    else void router.navigate({ to: '/' })
  }

  const [settings, setSettings] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [releases, setReleases] = useState<ReleasesState>({
    mode: 'none',
    version: '',
    releases: [],
    error: null,
  })
  const [releasesLoading, setReleasesLoading] = useState(false)
  const [exporter, setExporter] = useState<ExporterReleasesState>({
    mode: 'none',
    version: '',
    releases: [],
    error: null,
  })
  const [exporterLoading, setExporterLoading] = useState(false)
  const [releaseInstalling, setReleaseInstalling] = useState(false)
  const [releaseReport, setReleaseReport] = useState<InstallReport | null>(null)
  const [pluginInstalling, setPluginInstalling] = useState(false)
  const [pluginReport, setPluginReport] = useState<InstallReport | null>(null)
  // Version of the exporter DLL already in <Daz install>/plugins. null = not yet
  // checked / no install folder; '' = folder set but plugin not installed there.
  const [installedExporter, setInstalledExporter] = useState<string | null>(null)
  // The app's internal data folder (settings.json, recents.json, network-drives.json,
  // …), resolved once for display in the General tab.
  const [appDataFolder, setAppDataFolder] = useState('')

  // Project tab — per-project `.dcsp` behaviour defaults (only present when this
  // window is on a project). Saved independently of the machine settings below.
  const [pDazSubdir, setPDazSubdir] = useState(project?.dazSubdir ?? 'daz3d')
  const [pHoudiniSubdir, setPHoudiniSubdir] = useState(project?.houdiniSubdir ?? 'houdini')
  const [pCreateHoudini, setPCreateHoudini] = useState(project?.createHoudiniSubdir ?? true)
  const [pAssetsEnabled, setPAssetsEnabled] = useState(project?.assetsEnabled ?? false)
  const [pDazProductsEnabled, setPDazProductsEnabled] = useState(
    project?.dazProductsEnabled ?? false,
  )
  const [pCharactersSubdir, setPCharactersSubdir] = useState(project?.charactersSubdir ?? '')
  const [savingProject, setSavingProject] = useState(false)
  const [detectingDim, setDetectingDim] = useState(false)

  async function onDetectDimFolder() {
    setDetectingDim(true)
    try {
      const found = await detectDimManifestsFolder()
      if (found) {
        setSettings((s) => ({ ...s, dimManifestsFolder: found }))
        toast.success(`Found DIM manifests at ${displayPath(found)}`)
      } else {
        toast.error("Couldn't auto-detect the DIM manifests folder — set it manually.")
      }
    } finally {
      setDetectingDim(false)
    }
  }
  const projectDirty =
    !!project &&
    (pDazSubdir !== project.dazSubdir ||
      pHoudiniSubdir !== project.houdiniSubdir ||
      pCreateHoudini !== project.createHoudiniSubdir ||
      pAssetsEnabled !== project.assetsEnabled ||
      pDazProductsEnabled !== project.dazProductsEnabled ||
      pCharactersSubdir !== project.charactersSubdir ||
      // Edited on the Project tab (under the Daz Products toggle) but stored in
      // the machine settings — saved by onSaveProjectSettings alongside the manifest.
      settings.dimManifestsFolder !== initial.dimManifestsFolder)

  async function onSaveProjectSettings() {
    if (!project) return
    // Changing the characters subfolder physically MOVES every existing character
    // folder to the new root — confirm before that destructive, non-trivial move.
    const subdirChanged = pCharactersSubdir.trim() !== (project.charactersSubdir ?? '')
    if (subdirChanged) {
      const ok = await confirmDialog(
        'Change the characters subfolder?\n\nThis moves all existing character folders to the new location and repoints their scene/Houdini paths. Make sure no character files are open elsewhere.',
        { title: 'Move character folders', kind: 'warning' },
      )
      if (!ok) return
    }
    setSavingProject(true)
    try {
      // The DIM manifests folder lives under the Daz Products toggle on this tab
      // but is a machine setting (settings.json, not the .dcsp) — persist it too.
      if (settings.dimManifestsFolder !== initial.dimManifestsFolder) {
        await saveSettings({ data: settings })
      }
      await saveProjectSettings({
        data: {
          projectId: project.path,
          dazSubdir: pDazSubdir.trim() || 'daz3d',
          houdiniSubdir: pHoudiniSubdir.trim() || 'houdini',
          createHoudiniSubdir: pCreateHoudini,
          assetsEnabled: pAssetsEnabled,
          dazProductsEnabled: pDazProductsEnabled,
          charactersSubdir: pCharactersSubdir.trim(),
        },
      })
      await router.invalidate()
      toast.success('Project settings saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingProject(false)
    }
  }

  useEffect(() => {
    void fetchAppDataFolder().then(setAppDataFolder)
  }, [])

  // Inspect the DTH folder whenever it changes (debounced — typing shouldn't
  // hammer the filesystem; Browse sets it directly). Detects a single release vs
  // a folder of versioned releases.
  useEffect(() => {
    const folder = settings.dthPosesFolder
    if (!folder) {
      setReleases({ mode: 'none', version: '', releases: [], error: null })
      return
    }
    let cancelled = false
    setReleasesLoading(true)
    const timer = setTimeout(async () => {
      try {
        const result = await listDthReleases({ data: { folder } })
        if (!cancelled) setReleases(result)
      } finally {
        if (!cancelled) setReleasesLoading(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [settings.dthPosesFolder])

  // Same debounced inspection for the Exporter Plugin folder.
  useEffect(() => {
    const folder = settings.dthExporterFolder
    if (!folder) {
      setExporter({ mode: 'none', version: '', releases: [], error: null })
      return
    }
    let cancelled = false
    setExporterLoading(true)
    const timer = setTimeout(async () => {
      try {
        const result = await listDthExporterReleases({ data: { folder } })
        if (!cancelled) setExporter(result)
      } finally {
        if (!cancelled) setExporterLoading(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [settings.dthExporterFolder])

  // Multi-release with no valid selection yet → pre-select the latest. That
  // marks the form dirty so the user saves once to store CURRENT_DTH_VERSION;
  // later releases never switch the active version on their own.
  useEffect(() => {
    if (releases.mode !== 'multi' || releases.releases.length === 0) return
    setSettings((s) => {
      if (releases.releases.some((r) => r.version === s.currentDthVersion)) return s
      // Prefer the newest extracted folder — a zip can't be scanned.
      const preferred = releases.releases.find((r) => r.kind === 'folder') ?? releases.releases[0]
      return { ...s, currentDthVersion: preferred.version }
    })
  }, [releases])

  // Keep the stored Exporter version in step with the inspected folder: a single
  // plugin folder pins its detected version; a multi folder pre-selects the
  // newest when the current pick isn't among them.
  useEffect(() => {
    if (exporter.mode === 'single') {
      setSettings((s) =>
        s.currentDthExporterVersion === exporter.version
          ? s
          : { ...s, currentDthExporterVersion: exporter.version },
      )
    } else if (exporter.mode === 'multi' && exporter.releases.length > 0) {
      setSettings((s) => {
        if (exporter.releases.some((r) => r.version === s.currentDthExporterVersion)) return s
        return { ...s, currentDthExporterVersion: exporter.releases[0].version }
      })
    }
  }, [exporter])

  // Read the version of the exporter DLL already installed in the Daz plugins
  // folder, so the pane can show up-to-date / update-available. Debounced so
  // typing the install path doesn't re-read the DLL on every keystroke.
  const loadInstalledExporter = useCallback(async () => {
    if (!settings.dazInstallFolder) {
      setInstalledExporter(null)
      return
    }
    setInstalledExporter(await installedExporterVersion(settings.dazInstallFolder))
  }, [settings.dazInstallFolder])

  useEffect(() => {
    const timer = setTimeout(() => void loadInstalledExporter(), 350)
    return () => clearTimeout(timer)
  }, [loadInstalledExporter])

  // Scoped to the machine-setting fields the General tab edits. Save still writes the
  // full settings object, but the Tools-page fields are untouched here so they never
  // flip this dirty — the button reflects only this page's changes.
  const dirty =
    settings.dazLibraryFolder !== initial.dazLibraryFolder ||
    settings.dthPosesFolder !== initial.dthPosesFolder ||
    settings.currentDthVersion !== initial.currentDthVersion ||
    settings.dthExporterFolder !== initial.dthExporterFolder ||
    settings.currentDthExporterVersion !== initial.currentDthExporterVersion ||
    settings.dazInstallFolder !== initial.dazInstallFolder ||
    settings.houdiniDocsFolder !== initial.houdiniDocsFolder
  // Leaving with unsaved settings asks first (no programmatic navigations here —
  // the install flows save before acting, gated on this same dirty flag).
  useUnsavedChangesGuard(dirty, 'You have unsaved settings — leave and lose them?')

  // Re-scan the active release's poses and refresh dependent routes. The studio
  // keeps the pose list in memory (no on-disk cache), so this just re-runs the
  // native scan and updates it — done whenever the release settings are applied:
  // on Save and after installing a release. Returns the scan result so callers
  // can tailor their own toast.
  async function rebuildCatalog() {
    const result = await rescanPoseAssets()
    await router.invalidate()
    return result
  }

  // Saving stores the settings and re-scans the active release's poses — there's
  // no separate scan step.
  async function onSave() {
    setBusy(true)
    try {
      await saveSettings({ data: settings })
      const result = await rebuildCatalog()
      if (result.error) toast.error(result.error)
      else
        toast.success(
          `Saved — scanned ${result.assets.length} pose presets${
            result.releaseName ? ` from ${result.releaseName}` : ''
          }`,
        )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Two independent installs: the DTH release content (Daz library + Houdini),
  // and the admin-sensitive Exporter Plugin DLLs (Daz install). Each is enabled
  // once its own prerequisites are set; pending edits are saved automatically
  // before either runs (they read the saved settings).
  const releaseReady = !releases.error && releases.mode !== 'none'
  const exporterReady = !exporter.error && exporter.mode !== 'none'
  // The release install is split: Daz content → library, Houdini assets → the
  // Houdini documents folder — each half has its own prerequisites and buttons.
  const canInstallDaz = releaseReady && !!settings.dazLibraryFolder
  const canInstallHoudini = releaseReady && !!settings.houdiniDocsFolder
  const canInstallPlugin = exporterReady && !!settings.dazInstallFolder
  const dazBlockers: Array<string> = []
  if (!releaseReady) dazBlockers.push('a DTH release')
  if (!settings.dazLibraryFolder) dazBlockers.push('“My DAZ 3D Library”')
  const houdiniBlockers: Array<string> = []
  if (!releaseReady) houdiniBlockers.push('a DTH release')
  if (!settings.houdiniDocsFolder) houdiniBlockers.push('the Houdini documents folder')
  const pluginBlockers: Array<string> = []
  if (!exporterReady) pluginBlockers.push('a DTH Exporter Plugin')
  if (!settings.dazInstallFolder) pluginBlockers.push('the Daz Studio install folder')

  // Compare the release's exporter version with the one already in the plugins
  // folder to drive the status line + button label (Install / Update / Reinstall).
  const sourceExporterVer = exporter.version || settings.currentDthExporterVersion || ''
  const exporterUpToDate =
    !!installedExporter && !!sourceExporterVer && installedExporter === sourceExporterVer
  const pluginInstallLabel = !installedExporter
    ? 'Install'
    : exporterUpToDate
      ? 'Reinstall'
      : 'Update'

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

  // The sticky header's Save persists EVERY pending change — the machine settings
  // (General tab) and, in a project window, the project manifest (Project tab) —
  // one always-visible button regardless of which tab was edited.
  const anyDirty = dirty || projectDirty
  async function onSaveAll() {
    if (dirty) await onSave()
    if (projectDirty) await onSaveProjectSettings()
  }
  function onDiscardAll() {
    setSettings(initial)
    if (project) {
      setPDazSubdir(project.dazSubdir ?? 'daz3d')
      setPHoudiniSubdir(project.houdiniSubdir ?? 'houdini')
      setPCreateHoudini(project.createHoudiniSubdir ?? true)
      setPAssetsEnabled(project.assetsEnabled ?? false)
      setPDazProductsEnabled(project.dazProductsEnabled ?? false)
      setPCharactersSubdir(project.charactersSubdir ?? '')
    }
  }

  return (
    <main className="p-8">
      <FormHeader
        title="Settings"
        backLabel={backLabel}
        onBack={goBack}
        dirty={anyDirty}
        busy={busy || savingProject}
        onDiscard={onDiscardAll}
        onSave={() => void onSaveAll()}
      />

      <Tabs defaultValue="general" className="max-w-3xl">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          {project && <TabsTrigger value="project">Project</TabsTrigger>}
        </TabsList>

        <TabsContent value="general" className="space-y-5">
          <section className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="font-semibold">Setup DTH Release</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Select your DTH release, then install it into your Daz library and (optionally) your
                Houdini documents folder.
              </p>
            </div>

            <div>
              <FolderField
                label="DTH release(s) folder"
                value={settings.dthPosesFolder}
                placeholder="D:\DazToHue\Releases"
                onChange={(value) => setSettings((s) => ({ ...s, dthPosesFolder: value }))}
                help={
                  <>
                    Point this at a single DTH release folder, or a folder of multiple releases.
                    Zipped releases are listed but must be extracted first.
                  </>
                }
              />
              <ReleasePicker
                releases={releases}
                loading={releasesLoading}
                value={settings.currentDthVersion}
                onChange={(version) => setSettings((s) => ({ ...s, currentDthVersion: version }))}
              />
            </div>

            {(canInstallDaz || canInstallHoudini) && (
              <p className="text-sm text-muted-foreground">
                Ready to install DTH{' '}
                <strong className="text-foreground">
                  {releases.version || settings.currentDthVersion || '?'}
                </strong>
                {dirty ? ' — pending changes are saved on install.' : '.'}
              </p>
            )}

            <div>
              <FolderField
                label="My DAZ 3D Library"
                value={settings.dazLibraryFolder}
                placeholder="C:\Users\you\Documents\DAZ 3D\Studio\My Library"
                onChange={(value) => setSettings((s) => ({ ...s, dazLibraryFolder: value }))}
                help={
                  <>
                    Your Daz content library — where the release's content is installed.
                    {settings.dazLibraryFolder && (
                      <>
                        {' '}
                        Generated character scripts install to{' '}
                        <PathCode
                          path={displayPath(`${settings.dazLibraryFolder}/Scripts/DTH-Character-Studio`)}
                        />
                        .
                      </>
                    )}
                  </>
                }
              />
              {!canInstallDaz && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Set {dazBlockers.join(', ')} to enable this install.
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    runInstall(
                      (args) => installDthRelease({ data: { ...args.data, target: 'daz' } }),
                      true,
                      setReleaseInstalling,
                      setReleaseReport,
                    )
                  }
                  disabled={!canInstallDaz || releaseInstalling}
                >
                  {releaseInstalling ? 'Working…' : 'Dry run'}
                </Button>
                <Button
                  onClick={() =>
                    runInstall(
                      (args) => installDthRelease({ data: { ...args.data, target: 'daz' } }),
                      false,
                      setReleaseInstalling,
                      setReleaseReport,
                      undefined,
                      // Re-scan poses from the just-installed release so the studio
                      // can open/generate characters without a separate Save.
                      async () => {
                        const result = await rebuildCatalog()
                        if (result.error)
                          toast.error(`Installed, but the pose scan failed: ${result.error}`)
                        else
                          toast.success(
                            `Scanned ${result.assets.length} pose presets${
                              result.releaseName ? ` from ${result.releaseName}` : ''
                            }`,
                          )
                      },
                    )
                  }
                  disabled={!canInstallDaz || releaseInstalling}
                >
                  <Download /> {releaseInstalling ? 'Installing…' : 'Install'}
                </Button>
              </div>
            </div>

            <div className="border-t pt-4">
              <FolderField
                label="Houdini documents folder (optional)"
                value={settings.houdiniDocsFolder}
                placeholder="C:\Users\you\Documents\houdini20.5"
                onChange={(value) => setSettings((s) => ({ ...s, houdiniDocsFolder: value }))}
                help={
                  <>
                    Your Houdini user folder. The install merges the release's Houdini assets
                    (otls/presets/toolbar) into it.
                  </>
                }
              />
              {!canInstallHoudini && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Set {houdiniBlockers.join(', ')} to enable this install.
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    runInstall(
                      (args) => installDthRelease({ data: { ...args.data, target: 'houdini' } }),
                      true,
                      setReleaseInstalling,
                      setReleaseReport,
                    )
                  }
                  disabled={!canInstallHoudini || releaseInstalling}
                >
                  {releaseInstalling ? 'Working…' : 'Dry run'}
                </Button>
                <Button
                  onClick={() =>
                    runInstall(
                      (args) => installDthRelease({ data: { ...args.data, target: 'houdini' } }),
                      false,
                      setReleaseInstalling,
                      setReleaseReport,
                    )
                  }
                  disabled={!canInstallHoudini || releaseInstalling}
                >
                  <Download /> {releaseInstalling ? 'Installing…' : 'Install'}
                </Button>
              </div>
            </div>

            {releaseReport && (
              <InstallReportList report={releaseReport} onClose={() => setReleaseReport(null)} />
            )}
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="font-semibold">Setup DTH Exporter Plugin Release</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Select the Exporter Plugin release, then install its DLLs into Daz Studio's
                <span className="font-mono"> plugins</span> folder.
              </p>
            </div>

            <div>
              <FolderField
                label="DTH Exporter Plugin release(s) folder"
                value={settings.dthExporterFolder}
                placeholder="D:\DazToHue\ExporterPlugin"
                onChange={(value) => setSettings((s) => ({ ...s, dthExporterFolder: value }))}
                info={
                  <>
                    The Daz Studio <strong>DazToHue Exporter</strong> plugin — the DLL named like{' '}
                    <em>dsp_dth_exporter.dll</em>. Its version is read straight from the DLL, so the
                    folder needn't be version-named. Part of{' '}
                    <a
                      href="https://www.artstation.com/marketplace/p/BLM5K/daztohue"
                      target="_blank"
                      rel="noreferrer"
                    >
                      DazToHue
                    </a>{' '}
                    by mrpdean.
                  </>
                }
                help={
                  <>
                    The DazToHue Exporter plugin folder (contains the exporter DLL), or a folder of
                    versioned plugin folders. The version is read from the DLL.
                  </>
                }
              />
              <ExporterReleasePicker
                releases={exporter}
                loading={exporterLoading}
                value={settings.currentDthExporterVersion}
                onChange={(version) =>
                  setSettings((s) => ({ ...s, currentDthExporterVersion: version }))
                }
              />
            </div>

            <FolderField
              label="Daz Studio install folder"
              value={settings.dazInstallFolder}
              placeholder="C:\Program Files\DAZ 3D\DAZStudio4"
              onChange={(value) => setSettings((s) => ({ ...s, dazInstallFolder: value }))}
              help={
                <>
                  Where Daz Studio is installed. The DLLs go into its
                  <span className="font-mono"> /plugins</span> subfolder. Usually{' '}
                  <span className="font-mono">{'C:\\Program Files\\DAZ 3D\\DAZStudio4'}</span> (Daz
                  Studio 4, sometimes with a <span className="font-mono">64-bit</span> suffix) or{' '}
                  <span className="font-mono">{'C:\\Program Files\\DAZ 3D\\DAZStudio6'}</span> (Daz
                  Studio 6).
                </>
              }
            />

            {canInstallPlugin ? (
              <div className="space-y-1 text-sm text-muted-foreground">
                {!exporterUpToDate && (
                  <p>
                    Ready to install Exporter{' '}
                    <strong className="text-foreground">
                      {sourceExporterVer ||
                        settings.dthExporterFolder.split(/[\\/]/).filter(Boolean).pop() ||
                        '?'}
                    </strong>
                    {dirty ? ' — pending changes are saved on install.' : '.'}
                  </p>
                )}
                {installedExporter === '' ? (
                  <p>Not installed in this Daz Studio yet.</p>
                ) : installedExporter ? (
                  exporterUpToDate ? (
                    <p className="flex items-center gap-1.5 text-emerald-500">
                      <CircleCheck className="size-4 shrink-0" />
                      Already installed ({installedExporter}) — up to date.
                    </p>
                  ) : (
                    <p>
                      Installed: <strong className="text-foreground">{installedExporter}</strong> →
                      updating to <strong className="text-foreground">{sourceExporterVer || '?'}</strong>.
                    </p>
                  )
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Set {pluginBlockers.join(', ')} to enable the install.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => runInstall(installDthPlugin, true, setPluginInstalling, setPluginReport)}
                disabled={!canInstallPlugin || pluginInstalling}
              >
                {pluginInstalling ? 'Working…' : 'Dry run'}
              </Button>
              <Button
                onClick={() =>
                  runInstall(
                    installDthPlugin,
                    false,
                    setPluginInstalling,
                    setPluginReport,
                    () => void loadInstalledExporter(),
                  )
                }
                disabled={!canInstallPlugin || pluginInstalling}
              >
                <Download /> {pluginInstalling ? 'Installing…' : pluginInstallLabel}
              </Button>
            </div>

            {pluginReport && (
              <InstallReportList report={pluginReport} onClose={() => setPluginReport(null)} />
            )}

            {pluginReport?.steps.some((step) => step.status === 'error') && (
              <p className="text-sm text-destructive">
                Install failed — close all Daz and Houdini apps and restart DTH Character Studio as
                administrator, then try again.
              </p>
            )}
          </section>

          {/* Read-only — informational locations the app manages itself. */}
          <section className="space-y-5 rounded-lg border bg-card p-5">
            <div>
              <h2 className="mb-3 flex w-fit items-center gap-1 font-semibold">
                App data folder
                <InfoPopup label="App data folder — more information">
                  Where the app keeps its machine settings, the recent-projects list and
                  network-drive mappings. Project data (characters, avatars) lives in each
                  project's own folder.
                </InfoPopup>
              </h2>
              {appDataFolder ? (
                <PathCode path={displayPath(appDataFolder)} />
              ) : (
                <p className="text-xs text-muted-foreground">Resolving…</p>
              )}
            </div>
            <div className="border-t pt-5">
              <h2 className="mb-3 flex w-fit items-center gap-1 font-semibold">
                Network drives
                <InfoPopup label="Network drives — more information">
                  Mapped drives are remembered as you pick paths and re-mapped on startup, so the app
                  keeps working after relaunching as administrator.
                </InfoPopup>
              </h2>
              <NetworkDrivesSection />
            </div>
          </section>

        </TabsContent>

        {project && (
          <TabsContent value="project" className="space-y-5">
            <section className="space-y-4 rounded-lg border bg-card p-5">
              <div>
                <h2 className="font-semibold">{project.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  These settings are part of this project (stored in its{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">.dcsp</code> file).
                </p>
              </div>
              <div>
                <Label className="mb-1 flex w-fit items-center gap-1">
                  Characters subfolder
                  <InfoPopup label="Characters subfolder — more information">
                    Where character folders are stored, relative to the project — e.g.{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">assets/characters</code>{' '}
                    stores them at{' '}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      {'<project>/assets/characters/<Character>'}
                    </code>
                    . Empty keeps them directly in the project root. Changing this{' '}
                    <strong>moves the existing character folders</strong> to the new location (the
                    scene / Houdini links inside them are repointed).
                  </InfoPopup>
                </Label>
                <Input
                  value={pCharactersSubdir}
                  placeholder="(project root)"
                  onChange={(e) => setPCharactersSubdir(e.target.value)}
                />
              </div>
              <Field label="Daz scenes subfolder">
                <Input
                  value={pDazSubdir}
                  placeholder="daz3d"
                  onChange={(e) => setPDazSubdir(e.target.value)}
                />
              </Field>
              <Field label="Houdini projects subfolder">
                <Input
                  value={pHoudiniSubdir}
                  placeholder="houdini"
                  disabled={!pCreateHoudini}
                  onChange={(e) => setPHoudiniSubdir(e.target.value)}
                />
              </Field>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Create the Houdini subfolder in new characters</span>
                <Switch checked={pCreateHoudini} onCheckedChange={setPCreateHoudini} />
              </label>
              <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
                <span className="flex items-center gap-1 font-medium">
                  Enable attachments
                  <InfoPopup label="Enable attachments — more information">
                    Adds an <strong>Attachments</strong> tab for reusable Daz scenes (bases to build
                    characters on), stored in this project. Off by default — the project then has
                    characters only.
                  </InfoPopup>
                </span>
                <Switch checked={pAssetsEnabled} onCheckedChange={setPAssetsEnabled} />
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
                <span className="flex items-center gap-1 font-medium">
                  Enable Daz Products
                  <InfoPopup label="Enable Daz Products — more information">
                    Generates a <strong>Scan_Products_&lt;Character&gt;.dsa</strong> for each
                    character. Open the character's scene in Daz and run it: it analyses the scene
                    for used products and writes a CSV the character page reads back, so you can
                    review and store the found products. Set the{' '}
                    <strong>DAZ Install Manager manifests folder</strong> below for product names
                    &amp; SKUs. Off by default.
                  </InfoPopup>
                </span>
                <Switch checked={pDazProductsEnabled} onCheckedChange={setPDazProductsEnabled} />
              </div>
              <div>
                <FolderField
                  label="DAZ Install Manager manifests folder (optional)"
                  value={settings.dimManifestsFolder}
                  placeholder="E:\DAZ 3D\Install Manager\ManifestFiles"
                  onChange={(value) => setSettings((s) => ({ ...s, dimManifestsFolder: value }))}
                  info={
                    <>
                      The <strong>ManifestFiles</strong> folder DAZ Install Manager writes (a folder
                      of <code>.dsx</code> files) — see DIM → Advanced Settings → “Download/Install”.
                      The <strong>Daz Products</strong> scan reads it to resolve scene assets to
                      product names, SKUs and artists. Leave empty to skip product naming (the scan
                      still lists used assets). Machine-wide setting — shared by all projects
                      (stored with the app, not in the <code>.dcsp</code>).
                    </>
                  }
                  help={
                    <>
                      Read by the per-character product scan to identify installed products.
                    </>
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={onDetectDimFolder}
                  disabled={detectingDim}
                >
                  {detectingDim ? 'Detecting…' : 'Detect installed location'}
                </Button>
              </div>
            </section>
          </TabsContent>
        )}
      </Tabs>
    </main>
  )
}
