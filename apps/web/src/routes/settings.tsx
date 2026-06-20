import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import {
  ArrowLeft,
  CircleCheck,
  CircleSlash,
  CircleX,
  Download,
  FolderOpen,
  RefreshCw,
  Save,
} from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Switch } from '#/components/ui/switch.tsx'
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
  buildPoseCatalog,
  ensureNetworkDrives,
  fetchAppDataFolder,
  fetchKnownDrives,
  fetchSettings,
  forgetNetworkDrive,
  installDthPlugin,
  installDthRelease,
  installedExporterVersion,
  listDthExporterReleases,
  listDthReleases,
  refreshAllAssets,
  saveSettings,
  uncForPath,
} from '#/lib/rom/api.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { cn } from '#/lib/utils.ts'
import { PathCode } from '#/components/path-code.tsx'
import { toast } from 'sonner'
import { ROM_SECTIONS, SECTION_LABELS } from '@dth/rom'

import type { DthPoseAsset, GenesisVersion } from '@dth/rom'
import type {
  DthExporterReleaseInfo,
  DthReleaseInfo,
  InstallReport,
  RefreshSummary,
} from '#/lib/rom/api.ts'

/** A folder-path text field with a native "Browse…" picker button. */
function FolderField({
  label,
  value,
  placeholder,
  help,
  onChange,
  info,
}: {
  label: string
  value: string
  placeholder: string
  help: ReactNode
  onChange: (value: string) => void
  /** Optional rich text shown in an "i" info popup next to the label. */
  info?: ReactNode
}) {
  // Prefer the richer `info` text in the popup, falling back to `help`.
  const popup = info ?? help
  return (
    <div>
      <Label className="mb-1 flex w-fit items-center gap-1">
        {label}
        {popup ? <InfoPopup label={`${label} — more information`}>{popup}</InfoPopup> : null}
      </Label>
      <div className="flex gap-2">
        <Input
          value={displayPath(value)}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0"
          onClick={async () => {
            const picked = await pickFolder(label)
            if (picked) onChange(picked)
          }}
        >
          <FolderOpen /> Browse
        </Button>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/settings')({
  // Settings is reachable from several places; an optional `from` label lets the
  // entry point name the back link (the navigation itself just pops history).
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({
    from: typeof search.from === 'string' ? search.from : undefined,
  }),
  loader: () => fetchSettings(),
  component: SettingsPage,
})

interface ScanResult {
  folder: string
  releaseName: string
  version: string
  assets: Array<DthPoseAsset>
  error: string | null
}

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

const GENESIS_ORDER: Array<GenesisVersion> = ['G3', 'G8', 'G8.1', 'G9']

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

function ScanSummary({ result }: { result: ScanResult }) {
  if (result.error) {
    return <p className="text-sm text-destructive">{result.error}</p>
  }
  const byGenesis = new Map<GenesisVersion, Array<DthPoseAsset>>()
  let unclassified = 0
  for (const asset of result.assets) {
    if (!asset.genesis || !asset.section) {
      unclassified++
      continue
    }
    byGenesis.set(asset.genesis, [...(byGenesis.get(asset.genesis) ?? []), asset])
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Cached <strong className="text-foreground">{result.assets.length}</strong> pose presets
        {result.releaseName && (
          <>
            {' '}from <strong className="text-foreground">{result.releaseName}</strong>
            {result.version && <> (v{result.version})</>}
          </>
        )}
        {result.folder && (
          <>
            {' '}in <PathCode path={displayPath(result.folder)} />
          </>
        )}
        {unclassified > 0 && <> — {unclassified} could not be classified</>}
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {GENESIS_ORDER.filter((genesis) => byGenesis.has(genesis)).map((genesis) => {
          const assets = byGenesis.get(genesis)!
          return (
            <div key={genesis} className="rounded-lg border bg-card p-4">
              <h3 className="mb-2 font-semibold">{genesis}</h3>
              <ul className="space-y-1">
                {ROM_SECTIONS.filter((section) =>
                  assets.some((asset) => asset.section === section),
                ).map((section) => (
                  <li key={section} className="text-sm">
                    <span className="font-mono text-xs font-semibold text-muted-foreground">
                      {section}
                    </span>{' '}
                    <span className="text-muted-foreground">{SECTION_LABELS[section]}:</span>{' '}
                    {assets
                      .filter((asset) => asset.section === section)
                      .map((asset) => asset.name)
                      .join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
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

/**
 * "Refresh Assets" — re-generate the Daz scripts + PoseAsset CSVs for every
 * character in every project (e.g. after a studio update or a DTH-release
 * switch). Character definition JSONs aren't touched. Shows a per-run summary
 * with any failures/warnings.
 */
function RefreshAssetsSection() {
  const [refreshing, setRefreshing] = useState(false)
  const [summary, setSummary] = useState<RefreshSummary | null>(null)

  async function onRefresh() {
    setRefreshing(true)
    setSummary(null)
    try {
      const result = await refreshAllAssets()
      setSummary(result)
      if (result.runtime && !result.runtime.ok) {
        toast.error(`Runtime refresh failed: ${result.runtime.detail ?? ''}`)
      } else if (result.total === 0) {
        toast(result.runtime?.ok ? 'DTH runtime refreshed — no characters to regenerate' : 'No characters to refresh yet')
      } else if (result.failed > 0) {
        toast.error(`Re-generated ${result.regenerated} of ${result.total} — ${result.failed} failed`)
      } else {
        toast.success(
          `Re-generated assets for ${result.regenerated} character${result.regenerated === 1 ? '' : 's'}`,
        )
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  const failures = summary?.results.filter((r) => !r.ok) ?? []
  const warnings = summary?.results.filter((r) => r.ok && r.detail) ?? []

  return (
    <div className="space-y-3">
      <Button variant="outline" onClick={() => void onRefresh()} disabled={refreshing}>
        <RefreshCw className={refreshing ? 'animate-spin' : ''} />
        {refreshing ? 'Refreshing…' : 'Refresh Assets'}
      </Button>
      {summary && (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Re-generated <strong className="text-foreground">{summary.regenerated}</strong> of{' '}
            {summary.total} character{summary.total === 1 ? '' : 's'}
            {summary.failed > 0 && (
              <>
                {' · '}
                <span className="text-destructive">{summary.failed} failed</span>
              </>
            )}
            .
          </p>
          {summary.runtime && (
            <p className={summary.runtime.ok ? 'text-muted-foreground' : 'text-destructive'}>
              {summary.runtime.ok
                ? 'DTH runtime files refreshed.'
                : `DTH runtime refresh failed — ${summary.runtime.detail}`}
            </p>
          )}
          {failures.map((r, i) => (
            <p key={`f${i}`} className="flex items-start gap-2 text-destructive">
              <CircleX className="mt-0.5 size-4 shrink-0" />
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
              <CircleSlash className="mt-0.5 size-4 shrink-0" />
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
  )
}

/** Per-step result list shared by both install panes. */
function InstallReportList({ report }: { report: InstallReport }) {
  return (
    <ul className="space-y-1 border-t pt-3 text-sm">
      {report.steps.map((step, i) => (
        <li key={i} className="flex items-start gap-2">
          {step.status === 'ok' ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          ) : step.status === 'error' ? (
            <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" />
          ) : (
            <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <span className={step.status === 'error' ? 'text-destructive' : ''}>
            <span className="font-medium">{step.label}</span>
            {step.status === 'ok' && step.files > 0 && (
              <span className="text-muted-foreground"> — {step.files} file(s)</span>
            )}
            {step.detail && <span className="text-muted-foreground"> · {step.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

function SettingsPage() {
  const initial = Route.useLoaderData()
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
  const [scan, setScan] = useState<ScanResult | null>(null)
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
  // The app's internal data folder (settings.json, projects.json, images/, …),
  // resolved once for display in the General tab.
  const [appDataFolder, setAppDataFolder] = useState('')

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

  const dirty =
    settings.dazLibraryFolder !== initial.dazLibraryFolder ||
    settings.dthPosesFolder !== initial.dthPosesFolder ||
    settings.currentDthVersion !== initial.currentDthVersion ||
    settings.dthExporterFolder !== initial.dthExporterFolder ||
    settings.currentDthExporterVersion !== initial.currentDthExporterVersion ||
    settings.dazInstallFolder !== initial.dazInstallFolder ||
    settings.houdiniDocsFolder !== initial.houdiniDocsFolder ||
    settings.dazSubdir !== initial.dazSubdir ||
    settings.houdiniSubdir !== initial.houdiniSubdir ||
    settings.createHoudiniSubdir !== initial.createHoudiniSubdir

  // Saving also (re)builds the pose catalog for the active release — there's no
  // separate scan step.
  async function onSave() {
    setBusy(true)
    try {
      await saveSettings({ data: settings })
      const result = await buildPoseCatalog()
      setScan(result)
      await router.invalidate()
      if (result.error) toast.error(result.error)
      else
        toast.success(
          `Saved — cached ${result.assets.length} pose presets${
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
  const canInstallRelease = releaseReady && !!settings.dazLibraryFolder
  const canInstallPlugin = exporterReady && !!settings.dazInstallFolder
  const releaseBlockers: Array<string> = []
  if (!releaseReady) releaseBlockers.push('a DTH release')
  if (!settings.dazLibraryFolder) releaseBlockers.push('“My DAZ 3D Library”')
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
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyState(false)
      onComplete?.()
    }
  }

  return (
    <main className="p-8">
      <div className="mb-6">
        <button
          type="button"
          onClick={goBack}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {backLabel}
        </button>
      </div>
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
      </header>

      <Tabs defaultValue="general" className="max-w-3xl">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="daztohue">DazToHue</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-5 rounded-lg border bg-card p-5">
          <div className="max-w-[20rem]">
            <Label className="mb-1 flex w-fit items-center gap-1">
              Default Daz scenes subfolder
              <InfoPopup label="Default Daz scenes subfolder — more information">
                Pre-fills the subfolder when copying a Daz scene into a character.
              </InfoPopup>
            </Label>
            <Input
              value={settings.dazSubdir}
              placeholder="daz3d"
              onChange={(e) => setSettings((s) => ({ ...s, dazSubdir: e.target.value }))}
            />
          </div>
          <div className="max-w-[20rem]">
            <Label className="mb-1 flex w-fit items-center gap-1">
              Default Houdini projects subfolder
              <InfoPopup label="Default Houdini projects subfolder — more information">
                Seeded empty in each new character so you can drop its Houdini project there.
              </InfoPopup>
            </Label>
            <Input
              value={settings.houdiniSubdir}
              placeholder="houdini"
              disabled={!settings.createHoudiniSubdir}
              onChange={(e) => setSettings((s) => ({ ...s, houdiniSubdir: e.target.value }))}
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={settings.createHoudiniSubdir}
              onCheckedChange={(createHoudiniSubdir) =>
                setSettings((s) => ({ ...s, createHoudiniSubdir }))
              }
            />
            <span className="text-sm">Create Houdini project subfolder in new characters</span>
          </div>
          <div className="border-t pt-5">
            <h2 className="mb-3 flex w-fit items-center gap-1 font-semibold">
              Refresh assets
              <InfoPopup label="Refresh assets — more information">
                Re-generate the Daz scripts and PoseAsset CSVs for every character in every project —
                run this after updating the studio or switching DTH release so all generated files
                match the current version. Character definitions aren't changed.
              </InfoPopup>
            </h2>
            <RefreshAssetsSection />
          </div>
          <div className="border-t pt-5">
            <h2 className="mb-3 flex w-fit items-center gap-1 font-semibold">
              App data folder
              <InfoPopup label="App data folder — more information">
                Where the app keeps its settings, project list, pose catalog and avatar images.
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
        </TabsContent>

        <TabsContent value="daztohue" className="space-y-5">
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

            <FolderField
              label="My DAZ 3D Library"
              value={settings.dazLibraryFolder}
              placeholder="C:\Users\you\Documents\DAZ 3D\Studio\My Library"
              onChange={(value) => setSettings((s) => ({ ...s, dazLibraryFolder: value }))}
              help={
                <>
                  Your Daz content library — where the release's content is installed, and the output
                  location for generated character scripts.
                </>
              }
            />
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

            {canInstallRelease ? (
              <p className="text-sm text-muted-foreground">
                Ready to install DTH{' '}
                <strong className="text-foreground">
                  {releases.version || settings.currentDthVersion || '?'}
                </strong>
                {dirty ? ' — pending changes are saved on install.' : '.'}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Set {releaseBlockers.join(', ')} to enable the install.
              </p>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => runInstall(installDthRelease, true, setReleaseInstalling, setReleaseReport)}
                disabled={!canInstallRelease || releaseInstalling}
              >
                {releaseInstalling ? 'Working…' : 'Dry run'}
              </Button>
              <Button
                onClick={() => runInstall(installDthRelease, false, setReleaseInstalling, setReleaseReport)}
                disabled={!canInstallRelease || releaseInstalling}
              >
                <Download /> {releaseInstalling ? 'Installing…' : 'Install'}
              </Button>
            </div>

            {releaseReport && <InstallReportList report={releaseReport} />}
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
                  <span className="font-mono"> /plugins</span> subfolder.
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
                  <p className="text-xs">Not installed in this Daz Studio yet.</p>
                ) : installedExporter ? (
                  exporterUpToDate ? (
                    <p className="text-emerald-500">
                      Already installed ({installedExporter}) — up to date.
                    </p>
                  ) : (
                    <p className="text-xs">
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

            {pluginReport && <InstallReportList report={pluginReport} />}

            {pluginReport?.steps.some((step) => step.status === 'error') && (
              <p className="text-sm text-destructive">
                Install failed — close all Daz and Houdini apps and restart DTH Character Studio as
                administrator, then try again.
              </p>
            )}
          </section>
        </TabsContent>
      </Tabs>

      <div className="mt-6 max-w-3xl">
        <Button onClick={onSave} disabled={busy || !dirty}>
          <Save /> {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </div>

      {scan && (
        <section className="mt-8">
          <h2 className="mb-3 text-xl font-semibold">Pose catalog</h2>
          <ScanSummary result={scan} />
        </section>
      )}
    </main>
  )
}
