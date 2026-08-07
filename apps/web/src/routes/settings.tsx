import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { AlertTriangle, CircleCheck, Download, Plus } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button, Field, InfoPopup, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@dth/ui'
import { FormHeader } from '#/components/form-header.tsx'
import {
  detectDazInstalls,
  detectDimManifestsFolder,
  detectHoudiniInstalls,
  fetchActiveProject,
  fetchAppDataFolder,
  fetchPoseAssets,
  fetchRunnerStatus,
  fetchSettings,
  installDthPlugin,
  installDthRelease,
  installDthRunner,
  installedExporterVersion,
  listDthExporterReleases,
  listDthReleases,
  rescanPoseAssets,
  saveProjectSettings,
  saveSettings,
} from '#/lib/rom/api.ts'
import { navOrigin } from '#/lib/nav-origin.ts'
import { PROJECT_BEHAVIOR_DEFAULTS, runnerInstalledNewer } from '#/lib/rom/storage.ts'
import { useUnsavedChangesGuard } from '#/lib/use-unsaved-guard.ts'
import { useSettingsActions } from '#/lib/use-settings-actions.ts'
import { useConfirm } from '#/lib/use-confirm.tsx'
import { displayPath, parentDir } from '#/lib/path.ts'
import { houdiniVersionFromInstall, matchingHoudiniDocsFolder } from '#/lib/houdini-version.ts'
import { GuideLink } from '#/components/guide-link.tsx'
import { PathCode } from '#/components/path-code.tsx'
import { FolderField, InstallReportList } from '#/components/install-controls.tsx'
import { DazInstallSection } from '#/components/settings/daz-install-section.tsx'
import { defaultDazApp, deriveDazPaths } from '#/lib/daz-install.ts'
import { HoudiniInstallSection } from '#/components/settings/houdini-install-section.tsx'
import { defaultHoudiniInstall, deriveHoudiniPaths } from '#/lib/houdini-install.ts'
import { HousekeepingSection } from '#/components/settings/housekeeping-section.tsx'
import { NetworkDrivesSection } from '#/components/settings/network-drives-section.tsx'
import {
  ExporterReleasePicker,
  ReleasePicker,
} from '#/components/settings/release-pickers.tsx'
import { toast } from 'sonner'

import type {
  ExporterReleasesState,
  ReleasesState,
} from '#/components/settings/release-pickers.tsx'
import type { InstallReport, RunnerStatus } from '#/lib/rom/api.ts'
import type { DazInstallScan } from '#/lib/daz-install.ts'
import type { HoudiniInstallScan } from '#/lib/houdini-install.ts'

export const Route = createFileRoute('/settings')({
  // Settings is reachable from several places; an optional `from` label lets the
  // entry point name the back link (the navigation itself just pops history).
  // `tab` deep-links a specific tab (e.g. the export dialog's Runner-update
  // notice lands on General, not a project window's default Project tab).
  validateSearch: (search: Record<string, unknown>): { from?: string; tab?: SettingsTab } => ({
    from: typeof search.from === 'string' ? search.from : undefined,
    tab:
      search.tab === 'general' || search.tab === 'appdata' || search.tab === 'project'
        ? search.tab
        : undefined,
  }),
  // Machine settings + (when this window is on a project) that project's record, so
  // the Project tab can edit the per-project `.dcsp` defaults.
  loader: async () => ({ settings: await fetchSettings(), project: await fetchActiveProject() }),
  component: SettingsPage,
})

type SettingsTab = 'general' | 'appdata' | 'project'

/**
 * The editable per-project `.dcsp` manifest fields, held on the Project tab as one
 * state object (see {@link SettingsPage}). A new manifest field is added here and
 * flows through patch/dirty/save uniformly — no parallel `useState` to thread.
 */
interface ProjectSettings {
  dazSubdir: string
  houdiniSubdir: string
  exportSubdir: string
  createHoudiniSubdir: boolean
  assetsEnabled: boolean
  dazProductsEnabled: boolean
  charactersSubdir: string
  houdiniPathStyle: 'hip' | 'absolute'
}

/** The project's saved values — defaults from THE single copy in
 *  storage/projects (previously re-hardcoded here, free to drift). */
function projectSettingsFrom(project: Partial<ProjectSettings> | null | undefined): ProjectSettings {
  return {
    dazSubdir: project?.dazSubdir ?? PROJECT_BEHAVIOR_DEFAULTS.dazSubdir,
    houdiniSubdir: project?.houdiniSubdir ?? PROJECT_BEHAVIOR_DEFAULTS.houdiniSubdir,
    exportSubdir: project?.exportSubdir ?? PROJECT_BEHAVIOR_DEFAULTS.exportSubdir,
    createHoudiniSubdir:
      project?.createHoudiniSubdir ?? PROJECT_BEHAVIOR_DEFAULTS.createHoudiniSubdir,
    assetsEnabled: project?.assetsEnabled ?? PROJECT_BEHAVIOR_DEFAULTS.assetsEnabled,
    dazProductsEnabled: project?.dazProductsEnabled ?? PROJECT_BEHAVIOR_DEFAULTS.dazProductsEnabled,
    charactersSubdir: project?.charactersSubdir ?? PROJECT_BEHAVIOR_DEFAULTS.charactersSubdir,
    houdiniPathStyle: project?.houdiniPathStyle ?? PROJECT_BEHAVIOR_DEFAULTS.houdiniPathStyle,
  }
}

/**
 * What Save actually writes to the manifest (trims + subdir fallbacks). Shared
 * by the save payload AND the dirty comparison — comparing the raw form state
 * against the normalized on-disk baseline left the tab dirty FOREVER after
 * clearing a field (state '', manifest 'daz3d'), which also armed the
 * unsaved-changes guard on every navigation.
 */
function normalizeProjectSettings(s: ProjectSettings): ProjectSettings {
  return {
    ...s,
    dazSubdir: s.dazSubdir.trim() || 'daz3d',
    houdiniSubdir: s.houdiniSubdir.trim() || 'houdini',
    exportSubdir: s.exportSubdir.trim() || 'export',
    charactersSubdir: s.charactersSubdir.trim(),
  }
}

function SettingsPage() {
  const { settings: initial, project } = Route.useLoaderData()
  const { tab } = Route.useSearch()
  const router = useRouter()
  const confirm = useConfirm()

  // A HARD link to the page we entered the utility area from — never
  // history.back(), which walks tab switches one entry at a time.
  function goBack() {
    router.history.push(navOrigin())
  }

  const [settings, setSettings] = useState(initial)
  // Reconcile the form when the loader data changes underneath it (another window
  // saved settings and this window's route invalidated). Without this the form
  // keeps its once-seeded state, so `dirty` compares against the NEW `initial` and
  // lights up though the user changed nothing — and a Save then writes the stale
  // value back over the other window's change. Fields the user actually edited are
  // kept; fields still holding the previous loader value adopt the new one.
  const prevInitialRef = useRef(initial)
  useEffect(() => {
    const prev = prevInitialRef.current
    if (initial === prev) return
    prevInitialRef.current = initial
    setSettings((current) => {
      const next = { ...current }
      for (const key of Object.keys(initial) as Array<keyof typeof initial>) {
        // Untouched field (form still equals the previous loader value) → adopt the
        // new loader value; a user edit (differs from previous) stays put.
        // (Object.assign avoids the union-key indexed-write type widening.)
        if (JSON.stringify(current[key]) === JSON.stringify(prev[key])) {
          Object.assign(next, { [key]: initial[key] })
        }
      }
      return next
    })
  }, [initial])
  const [busy, setBusy] = useState(false)
  const [releases, setReleases] = useState<ReleasesState>({
    mode: 'none',
    version: '',
    releases: [],
    error: null,
  })
  const [releasesLoading, setReleasesLoading] = useState(false)
  // Pinned-release health of the SAVED selection, read from the session pose
  // catalog (storage/releases.ts threads it through scanPoseAssets): when the
  // saved `currentDthVersion` no longer exists on disk, the cascade silently
  // scans the newest release instead — surface that swap here instead of
  // letting generation quietly run against a release the user never chose.
  const [pinnedMissing, setPinnedMissing] = useState<{ missing: string; using: string } | null>(
    null,
  )
  const [exporter, setExporter] = useState<ExporterReleasesState>({
    mode: 'none',
    version: '',
    releases: [],
    error: null,
  })
  const [exporterLoading, setExporterLoading] = useState(false)
  const [releaseInstalling, setReleaseInstalling] = useState(false)
  // The release install report is split per target so each renders next to its
  // own buttons: the Daz report under the "My DAZ 3D Library" install, the
  // Houdini report at the bottom (shared by the primary + any extra folders).
  const [dazReport, setDazReport] = useState<InstallReport | null>(null)
  const [houdiniReport, setHoudiniReport] = useState<InstallReport | null>(null)
  const [pluginInstalling, setPluginInstalling] = useState(false)
  const [pluginReport, setPluginReport] = useState<InstallReport | null>(null)
  // Version of the exporter DLL already in <Daz install>/plugins. null = not yet
  // checked / no install folder; '' = folder set but plugin not installed there.
  const [installedExporter, setInstalledExporter] = useState<string | null>(null)
  // The app's internal data folder (settings.json, recents.json, network-drives.json,
  // …), resolved once for display in the App Data tab.
  const [appDataFolder, setAppDataFolder] = useState('')

  // Project tab — per-project `.dcsp` behaviour defaults (only present when this
  // window is on a project). Saved independently of the machine settings below.
  // Held as one object + patch updater (mirrors the character route) so a new
  // manifest field is a one-line addition rather than another parallel `useState`.
  const [projectSettings, setProjectSettings] = useState<ProjectSettings>(() =>
    projectSettingsFrom(project),
  )
  const patchProject = (partial: Partial<ProjectSettings>) =>
    setProjectSettings((s) => ({ ...s, ...partial }))
  // The saved-on-disk values, refreshed by `router.invalidate()` after a save —
  // dirty is `projectSettings` measured against this (matching the old per-field
  // comparison against the live `project`).
  const projectBaseline = projectSettingsFrom(project)
  // Loader-reconcile, symmetrical to the machine-settings effect above: when the
  // loader's project record changes underneath the form (a save in THIS window
  // invalidated the route, or another window edited the manifest), untouched
  // fields adopt the new values; fields the user actually edited stay put.
  const prevProjectRef = useRef(project)
  useEffect(() => {
    const prev = prevProjectRef.current
    if (project === prev) return
    prevProjectRef.current = project
    if (!project) return
    const prevValues = projectSettingsFrom(prev)
    const nextValues = projectSettingsFrom(project)
    setProjectSettings((current) => {
      const next = { ...current }
      for (const key of Object.keys(nextValues) as Array<keyof ProjectSettings>) {
        if (JSON.stringify(current[key]) === JSON.stringify(prevValues[key])) {
          Object.assign(next, { [key]: nextValues[key] })
        }
      }
      return next
    })
  }, [project])
  const [savingProject, setSavingProject] = useState(false)
  const [detectingDim, setDetectingDim] = useState(false)

  // --- the Daz installation DIM already knows about -------------------------
  const [dazScan, setDazScan] = useState<DazInstallScan | null>(null)
  const [dazScanning, setDazScanning] = useState(true)
  /** The card mid-activation — the write is a disk round trip, not instant. */
  const [activating, setActivating] = useState('')

  const rescanDazInstalls = useCallback(async () => {
    setDazScanning(true)
    try {
      setDazScan(await detectDazInstalls())
    } catch {
      // Detection is an offer, never a requirement: a machine with no DIM (or
      // an unreadable one) keeps the manual fields and says so in the section.
      setDazScan(null)
    } finally {
      setDazScanning(false)
    }
  }, [])

  useEffect(() => {
    void rescanDazInstalls()
  }, [rescanDazInstalls])

  /**
   * Activate one installation: derive the three paths and WRITE them.
   *
   * Auto-saving is the point — the paths are a consequence of the choice, so
   * leaving them pending behind a Save button would mean a first run where the
   * user picks their install and the app still behaves as if nothing is set.
   * The router invalidate afterwards refreshes the loader baseline, so this
   * does not leave the page looking dirty.
   */
  async function onActivateDazInstall(key: string) {
    if (!dazScan) return
    const derived = deriveDazPaths(dazScan, key)
    if (!derived) return
    setActivating(key)
    const next = { ...settings, ...derived, dazInstallKey: key }
    try {
      await saveSettings({ data: { settings: next, baseline: initial } })
      setSettings(next)
      await router.invalidate()
      const app = dazScan.apps.find((candidate) => candidate.key === key)
      // Name what is still missing rather than reporting a clean success: DIM
      // can know the Studio folder and nothing about a library.
      const gaps = [
        derived.dazLibraryFolder ? '' : 'the content library',
        derived.dimManifestsFolder ? '' : 'the product database',
      ].filter(Boolean)
      toast.success(
        `${app?.name ?? 'Installation'} activated.` +
          (gaps.length > 0 ? ` DIM had no value for ${gaps.join(' or ')} — set it below.` : ''),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setActivating('')
    }
  }

  /** Hand the three paths back to the user, keeping their current values. */
  async function onSetDazPathsManually() {
    const next = { ...settings, dazInstallKey: '' }
    try {
      await saveSettings({ data: { settings: next, baseline: initial } })
      setSettings(next)
      await router.invalidate()
      toast.success('The Daz paths are yours to edit — they keep their current values.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  /** true = the paths below are derived, so they are shown read-only. */
  const dazDerived = settings.dazInstallKey !== ''

  // --- the Houdini versions SideFX registered -------------------------------
  const [houdiniScan, setHoudiniScan] = useState<HoudiniInstallScan | null>(null)
  const [houdiniScanning, setHoudiniScanning] = useState(true)
  const [activatingHoudini, setActivatingHoudini] = useState('')

  const rescanHoudiniInstalls = useCallback(async () => {
    setHoudiniScanning(true)
    try {
      setHoudiniScan(await detectHoudiniInstalls())
    } catch {
      setHoudiniScan(null)
    } finally {
      setHoudiniScanning(false)
    }
  }, [])

  useEffect(() => {
    void rescanHoudiniInstalls()
  }, [rescanHoudiniInstalls])

  /** Activate one Houdini: install folder + its paired documents folder, saved
   *  on the spot — same contract as the Daz side. */
  async function onActivateHoudini(version: string) {
    if (!houdiniScan) return
    const derived = deriveHoudiniPaths(houdiniScan, version)
    if (!derived) return
    setActivatingHoudini(version)
    const next = { ...settings, ...derived, houdiniInstallKey: version }
    try {
      await saveSettings({ data: { settings: next, baseline: initial } })
      setSettings(next)
      await router.invalidate()
      const install = houdiniScan.installs.find((candidate) => candidate.version === version)
      toast.success(
        `${install?.name ?? 'Houdini'} activated.` +
          // Named rather than silently empty: without a prefs folder hython
          // loads no DazToHue otls, so this is the difference between a working
          // Generate project and one that reports an empty scene.
          (derived.houdiniDocsFolder
            ? ''
            : ' No documents folder found — start this Houdini once, or set it below.'),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setActivatingHoudini('')
    }
  }

  async function onSetHoudiniPathsManually() {
    const next = { ...settings, houdiniInstallKey: '' }
    try {
      await saveSettings({ data: { settings: next, baseline: initial } })
      setSettings(next)
      await router.invalidate()
      toast.success('The Houdini paths are yours to edit — they keep their current values.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  /** true = the Houdini paths follow an activated installation. */
  const houdiniDerived = settings.houdiniInstallKey !== ''

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
    } catch (e) {
      // try/finally alone left a thrown probe as an unhandled rejection.
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDetectingDim(false)
    }
  }
  // Normalized-vs-normalized (the exact values Save writes) — a cleared field
  // that normalizes back to its stored value is NOT a pending change.
  const projectDirty =
    !!project &&
    (JSON.stringify(normalizeProjectSettings(projectSettings)) !==
      JSON.stringify(normalizeProjectSettings(projectBaseline)) ||
      // Edited on the Project tab (under the Daz Products toggle) but stored in
      // the machine settings — saved by onSaveProjectSettings alongside the manifest.
      settings.dimManifestsFolder !== initial.dimManifestsFolder)

  async function onSaveProjectSettings(machineSettingsSaved = false) {
    if (!project) return
    // The manifest-normalized values — the ONE shape both the payload below and
    // the dirty comparison use (see normalizeProjectSettings).
    const normalized = normalizeProjectSettings(projectSettings)
    // Changing the characters subfolder physically MOVES every existing character
    // folder to the new root — confirm before that destructive, non-trivial move.
    const subdirChanged = normalized.charactersSubdir !== (project.charactersSubdir ?? '')
    if (subdirChanged) {
      const ok = await confirm(
        'Change the characters subfolder?\n\nThis moves all existing character folders to the new location and repoints their scene/Houdini paths. Make sure no character files are open elsewhere.',
        { title: 'Move character folders', confirmLabel: 'Move folders' },
      )
      if (!ok) return
    }
    setSavingProject(true)
    try {
      // The DIM manifests folder lives under the Daz Products toggle on this tab
      // but is a machine setting (settings.json, not the .dcsp) — persist it too,
      // UNLESS the header's Save-all just ran onSave: that already wrote the full
      // settings object, and a second write here would ride the stale `initial`
      // baseline.
      if (!machineSettingsSaved && settings.dimManifestsFolder !== initial.dimManifestsFolder) {
        await saveSettings({ data: { settings, baseline: initial } })
      }
      await saveProjectSettings({
        data: {
          projectId: project.path,
          dazSubdir: normalized.dazSubdir,
          houdiniSubdir: normalized.houdiniSubdir,
          exportSubdir: normalized.exportSubdir,
          createHoudiniSubdir: normalized.createHoudiniSubdir,
          assetsEnabled: normalized.assetsEnabled,
          dazProductsEnabled: normalized.dazProductsEnabled,
          charactersSubdir: normalized.charactersSubdir,
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

  // Seed the pinned-release warning from the session catalog on entry (Save and
  // the release install refresh it via rebuildCatalog). Errors stay silent here:
  // an unconfigured/unreachable release already surfaces through the pickers.
  useEffect(() => {
    let active = true
    fetchPoseAssets()
      .then((result) => {
        if (active)
          setPinnedMissing(
            result.pinnedMissing ? { missing: result.pinnedMissing, using: result.version } : null,
          )
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  // Inspect the DTH folder whenever it changes (debounced — typing shouldn't
  // hammer the filesystem; Browse sets it directly). Detects a single release vs
  // a folder of versioned releases.
  useEffect(() => {
    const folder = settings.dthPosesFolder
    if (!folder) {
      setReleases({ mode: 'none', version: '', releases: [], error: null })
      // Clear the spinner too: the previous run's `finally` is skipped once its
      // effect is cancelled, so without this "Looking for DTH releases…" sticks
      // forever when the folder is cleared mid-inspection.
      setReleasesLoading(false)
      return
    }
    let cancelled = false
    setReleasesLoading(true)
    // Named + `void`d rather than an async callback handed to setTimeout: the
    // timer discards what it returns either way, and this says so. Every
    // outcome is already handled below, so there is nothing left to await.
    async function inspect() {
      try {
        const result = await listDthReleases({ data: { folder } })
        if (!cancelled) setReleases(result)
      } catch (e) {
        // Without this, a rejected inspection was an unhandled rejection AND the
        // pane kept showing the previous folder's releases — clear them and use
        // the pane's existing error surface instead.
        if (!cancelled)
          setReleases({
            mode: 'none',
            version: '',
            releases: [],
            error: e instanceof Error ? e.message : String(e),
          })
      } finally {
        if (!cancelled) setReleasesLoading(false)
      }
    }
    const timer = setTimeout(() => void inspect(), 350)
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
      // Clear the spinner too (see the releases effect above).
      setExporterLoading(false)
      return
    }
    let cancelled = false
    setExporterLoading(true)
    // Named + `void`d, same as the releases effect above.
    async function inspect() {
      try {
        const result = await listDthExporterReleases({ data: { folder } })
        if (!cancelled) setExporter(result)
      } catch (e) {
        // Clear the stale list + show the error (see the releases effect above).
        if (!cancelled)
          setExporter({
            mode: 'none',
            version: '',
            releases: [],
            error: e instanceof Error ? e.message : String(e),
          })
      } finally {
        if (!cancelled) setExporterLoading(false)
      }
    }
    const timer = setTimeout(() => void inspect(), 350)
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
  // folder, so the pane can show up-to-date / update-available. ONE cancel-aware
  // reader shared by the debounced effect below and the post-install refresh: a
  // read only stamps its result while it is still the NEWEST read (sequence
  // check) for the CURRENT folder (ref check) — a slow read can never stamp a
  // stale version over a fresher one, and a folder change discards in-flight
  // reads for the previous folder.
  const exporterReadSeq = useRef(0)
  const dazInstallFolderRef = useRef(settings.dazInstallFolder)
  dazInstallFolderRef.current = settings.dazInstallFolder
  const loadInstalledExporter = useCallback(async () => {
    const seq = ++exporterReadSeq.current
    const folder = dazInstallFolderRef.current
    const version = folder ? await installedExporterVersion(folder) : null
    if (seq === exporterReadSeq.current && folder === dazInstallFolderRef.current)
      setInstalledExporter(version)
  }, [])

  // The bundled Runner plugin's state vs the same Daz install folder — same
  // cancel-aware reader pattern as loadInstalledExporter above.
  const [runnerState, setRunnerState] = useState<RunnerStatus | null>(null)
  const [runnerInstalling, setRunnerInstalling] = useState(false)
  const [runnerReport, setRunnerReport] = useState<InstallReport | null>(null)
  const runnerReadSeq = useRef(0)
  const loadRunnerStatus = useCallback(async () => {
    const seq = ++runnerReadSeq.current
    const folder = dazInstallFolderRef.current
    const status = await fetchRunnerStatus(folder)
    if (seq === runnerReadSeq.current && folder === dazInstallFolderRef.current)
      setRunnerState(status)
  }, [])

  // Debounced so typing the install path doesn't re-read the DLLs on every
  // keystroke (an emptied folder clears immediately). The timer only guards the
  // START of a read — in-flight staleness is each helper's own validity check.
  useEffect(() => {
    if (!settings.dazInstallFolder) {
      void loadInstalledExporter()
      void loadRunnerStatus()
      return
    }
    const timer = setTimeout(() => {
      void loadInstalledExporter()
      void loadRunnerStatus()
    }, 350)
    return () => clearTimeout(timer)
  }, [settings.dazInstallFolder, loadInstalledExporter, loadRunnerStatus])

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
    // `dimManifestsFolder` is deliberately NOT here: the Project tab owns its
    // manual edit (and `projectDirty` tracks that), while activating an
    // installation writes it straight to disk — neither route leaves it pending.
    settings.dazInstallKey !== initial.dazInstallKey ||
    settings.houdiniDocsFolder !== initial.houdiniDocsFolder ||
    settings.houdiniInstallFolder !== initial.houdiniInstallFolder ||
    JSON.stringify(settings.extraHoudiniDocsFolders) !==
      JSON.stringify(initial.extraHoudiniDocsFolders)
  // Leaving with unsaved settings asks first — covers BOTH the machine settings
  // and the Project-tab manifest edits (install flows save before acting; they
  // gate on `dirty` for the machine half specifically).
  useUnsavedChangesGuard(
    dirty || projectDirty,
    'You have unsaved settings — leave and lose them?',
  )

  // Re-scan the active release's poses and refresh dependent routes. The studio
  // keeps the pose list in memory (no on-disk cache), so this just re-runs the
  // native scan and updates it — done whenever the release settings are applied:
  // on Save and after installing a release. Returns the scan result so callers
  // can tailor their own toast.
  async function rebuildCatalog() {
    const result = await rescanPoseAssets()
    // Keep the release pane's pinned-release warning in step with the scan just
    // run — saving a valid pick clears it; a still-broken pin keeps it up.
    setPinnedMissing(
      result.pinnedMissing ? { missing: result.pinnedMissing, using: result.version } : null,
    )
    await router.invalidate()
    return result
  }

  // Saving stores the settings and re-scans the active release's poses — there's
  // no separate scan step. Returns whether the settings WRITE reached disk, so
  // Save-all can tell the project save the truth (a failed write must not make
  // it skip its own dim-manifests write as "already saved"); a failed re-scan
  // after a successful write still counts as saved.
  async function onSave(): Promise<boolean> {
    setBusy(true)
    let saved = false
    try {
      await saveSettings({ data: { settings, baseline: initial } })
      saved = true
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
    return saved
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

  // The Runner ships with the app — only the Daz install folder gates it (plus
  // a readable status: flavor detected, bundled DLL present).
  const canInstallRunner = !!settings.dazInstallFolder && !!runnerState && !runnerState.error
  const runnerInstallLabel =
    runnerState?.installed === 'none'
      ? 'Install'
      : runnerState?.installed === 'current'
        ? 'Reinstall'
        : 'Update'

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
  // Shared with the Tools page: save pending settings edits, then run the install.
  const { runInstall } = useSettingsActions({
    dirty,
    settings,
    baseline: initial,
    // The save-before-action applies the release selection exactly like Save
    // does — rescan so the session catalog + `pinnedMissing` (the amber banner)
    // reflect the just-persisted pick even when the action is only a dry run.
    // Errors stay silent, like the seed effect above: an unreachable release
    // already surfaces through the pickers, and a failed scan must not abort
    // the install the user actually asked for.
    onSaved: async () => {
      await rebuildCatalog().catch(() => {})
    },
  })

  // The sticky header's Save persists EVERY pending change — the machine settings
  // (General tab) and, in a project window, the project manifest (Project tab) —
  // one always-visible button regardless of which tab was edited.
  const anyDirty = dirty || projectDirty
  async function onSaveAll() {
    // When onSave just ran AND SUCCEEDED it wrote the FULL settings object (dim
    // manifests folder included) — tell the project save so it doesn't write
    // them again. `onSave` swallows its own failures, so `dirty` alone would
    // report a FAILED save as "already saved" and skip that write entirely.
    const machineSettingsSaved = dirty ? await onSave() : false
    if (projectDirty) await onSaveProjectSettings(machineSettingsSaved)
  }
  function onDiscardAll() {
    setSettings(initial)
    if (project) setProjectSettings(projectSettingsFrom(project))
  }

  return (
    <main className="p-8">
      <FormHeader
        title="Settings"
        onBack={goBack}
        dirty={anyDirty}
        busy={busy || savingProject}
        onDiscard={onDiscardAll}
        onSave={() => void onSaveAll()}
      />

      {/* In a project window the Project tab leads (and opens by default) —
          matching the tab order; General/App Data are machine-wide. A `tab`
          search param overrides (guarded: `project` without a project window
          falls back to the default). */}
      <Tabs
        defaultValue={tab && (tab !== 'project' || project) ? tab : project ? 'project' : 'general'}
        className="max-w-3xl"
      >
        <TabsList>
          {project && <TabsTrigger value="project">Project</TabsTrigger>}
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="appdata">App Data</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-5">
          {/* First, because everything below it depends on which Daz is meant —
              and on a fresh install this is the only thing the user has to do
              before the release install becomes possible. */}
          <section className="space-y-4 rounded-lg border bg-card p-5">
            <DazInstallSection
              scan={dazScan}
              loading={dazScanning}
              activeKey={settings.dazInstallKey}
              derived={
                dazDerived
                  ? {
                      dazLibraryFolder: settings.dazLibraryFolder,
                      dazInstallFolder: settings.dazInstallFolder,
                      dimManifestsFolder: settings.dimManifestsFolder,
                    }
                  : null
              }
              busyKey={activating}
              // Pointed at, not auto-activated: nothing is written until the
              // user picks (their spec, and the right call — a first run that
              // silently adopts an installation is a first run that decided for
              // them). Newest Studio wins, so DS6 on a DS4+DS6 machine.
              recommendedKey={dazScan ? (defaultDazApp(dazScan.apps)?.key ?? '') : ''}
              onRescan={() => void rescanDazInstalls()}
              onActivate={(key) => void onActivateDazInstall(key)}
              onSetManually={() => void onSetDazPathsManually()}
            />
          </section>

          <section className="space-y-4 rounded-lg border bg-card p-5">
            <HoudiniInstallSection
              scan={houdiniScan}
              loading={houdiniScanning}
              activeKey={settings.houdiniInstallKey}
              derived={
                houdiniDerived
                  ? {
                      houdiniInstallFolder: settings.houdiniInstallFolder,
                      houdiniDocsFolder: settings.houdiniDocsFolder,
                    }
                  : null
              }
              busyKey={activatingHoudini}
              recommendedKey={
                houdiniScan ? (defaultHoudiniInstall(houdiniScan.installs)?.version ?? '') : ''
              }
              onRescan={() => void rescanHoudiniInstalls()}
              onActivate={(version) => void onActivateHoudini(version)}
              onSetManually={() => void onSetHoudiniPathsManually()}
            />
          </section>

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
                // Unset: start at the Exporter-plugin folder's parent — the two
                // DazToHue downloads almost always live under one root.
                browseFrom={parentDir(settings.dthExporterFolder)}
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
              {pinnedMissing && (
                <div className="mt-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                  Pinned version {pinnedMissing.missing} is missing —{' '}
                  {pinnedMissing.using
                    ? `using ${pinnedMissing.using}`
                    : 'using the newest available release'}
                  . Pick a version and Save to re-pin.
                </div>
              )}
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
              {/* No field at all once an installation is active: the library is
                  derived, and the Daz installation card above already lists it.
                  A second copy here is the same path shown twice — it can only
                  ever agree, and it puts a control where there is no choice to
                  make. What DOES belong at the moment of installing is the
                  DESTINATION, which is the line below the buttons' gate. */}
              {!dazDerived && (
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
              )}
              {dazDerived && (
                <DerivedTarget
                  value={settings.dazLibraryFolder}
                  missing="library"
                  className={canInstallDaz ? '' : 'mt-2'}
                >
                  Generated character scripts go to{' '}
                  <PathCode
                    path={displayPath(`${settings.dazLibraryFolder}/Scripts/DTH-Character-Studio`)}
                  />
                  .
                </DerivedTarget>
              )}
              {!canInstallDaz && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Set {dazBlockers.join(', ')} to enable this install.
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    void runInstall(
                      (args) => installDthRelease({ data: { ...args.data, target: 'daz' } }),
                      true,
                      setReleaseInstalling,
                      setDazReport,
                    )
                  }
                  disabled={!canInstallDaz || releaseInstalling}
                >
                  {releaseInstalling ? 'Working…' : 'Dry run'}
                </Button>
                <Button
                  onClick={() =>
                    void runInstall(
                      (args) => installDthRelease({ data: { ...args.data, target: 'daz' } }),
                      false,
                      setReleaseInstalling,
                      setDazReport,
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
              {dazReport && (
                <InstallReportList report={dazReport} onClose={() => setDazReport(null)} />
              )}
            </div>

            <div className="border-t pt-4">
              {/* Derived with the installation, and listed in its card — same
                  rule as the Daz half: no second copy, just the destination. */}
              {houdiniDerived ? (
                <DerivedTarget
                  value={settings.houdiniDocsFolder}
                  missing="Houdini documents folder"
                >
                  The release&apos;s Houdini assets (otls/presets/toolbar) merge into it.
                </DerivedTarget>
              ) : (
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
              )}
              {!canInstallHoudini && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Set {houdiniBlockers.join(', ')} to enable this install.
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    void runInstall(
                      (args) => installDthRelease({ data: { ...args.data, target: 'houdini' } }),
                      true,
                      setReleaseInstalling,
                      setHoudiniReport,
                    )
                  }
                  disabled={!canInstallHoudini || releaseInstalling}
                >
                  {releaseInstalling ? 'Working…' : 'Dry run'}
                </Button>
                <Button
                  onClick={() =>
                    void runInstall(
                      (args) => installDthRelease({ data: { ...args.data, target: 'houdini' } }),
                      false,
                      setReleaseInstalling,
                      setHoudiniReport,
                    )
                  }
                  disabled={!canInstallHoudini || releaseInstalling}
                >
                  <Download /> {releaseInstalling ? 'Installing…' : 'Install'}
                </Button>
              </div>
            </div>

            {/* Additional Houdini versions: each folder is its own install target,
                so an OLD Houdini can carry an OLD DTH release (pick that version
                in the release dropdown above, install here, switch back) while
                the primary folder stays on the current one. */}
            {settings.extraHoudiniDocsFolders.map((folder, i) => (
              <div key={i} className="border-t pt-4">
                <FolderField
                  label={`Additional Houdini documents folder ${i + 1}`}
                  value={folder}
                  // Unset: the folder holding the primary docs folder — every
                  // other version's sits right beside it (houdini19.5 next to
                  // houdini22.0), which is as close as this gets.
                  browseFrom={parentDir(settings.houdiniDocsFolder)}
                  placeholder="C:\Users\you\Documents\houdini19.5"
                  onChange={(value) =>
                    setSettings((s) => ({
                      ...s,
                      extraHoudiniDocsFolders: s.extraHoudiniDocsFolders.map((f, fi) =>
                        fi === i ? value : f,
                      ),
                    }))
                  }
                  help={
                    <>
                      Another Houdini version's user folder — installs the release picked
                      above into it, independent of the primary folder.
                    </>
                  }
                />
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      void runInstall(
                        (args) =>
                          installDthRelease({
                            data: { ...args.data, target: 'houdini', houdiniDocsFolder: folder },
                          }),
                        true,
                        setReleaseInstalling,
                        setHoudiniReport,
                      )
                    }
                    disabled={!releaseReady || !folder.trim() || releaseInstalling}
                  >
                    {releaseInstalling ? 'Working…' : 'Dry run'}
                  </Button>
                  <Button
                    onClick={() =>
                      void runInstall(
                        (args) =>
                          installDthRelease({
                            data: { ...args.data, target: 'houdini', houdiniDocsFolder: folder },
                          }),
                        false,
                        setReleaseInstalling,
                        setHoudiniReport,
                      )
                    }
                    disabled={!releaseReady || !folder.trim() || releaseInstalling}
                  >
                    <Download /> {releaseInstalling ? 'Installing…' : 'Install'}
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        extraHoudiniDocsFolders: s.extraHoudiniDocsFolders.filter(
                          (_, fi) => fi !== i,
                        ),
                      }))
                    }
                    disabled={releaseInstalling}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
            <div className="border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSettings((s) => ({
                    ...s,
                    extraHoudiniDocsFolders: [...s.extraHoudiniDocsFolders, ''],
                  }))
                }
              >
                <Plus /> Add another Houdini folder
              </Button>
            </div>

            {houdiniReport && (
              <InstallReportList report={houdiniReport} onClose={() => setHoudiniReport(null)} />
            )}
          </section>

          {/* "Generate project" prerequisite: hython (from the Houdini install)
              creates a ready-made DazToHue project — the network is instantiated
              from the INSTALLED DazToHue HDA (no template scene to rot across
              Houdini/DazToHue versions), Set Project baked to the character's
              Houdini project folder. */}
          <section className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="font-semibold">Generate Houdini Projects</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Used by the character page&apos;s <em>Generate project</em> button: hython
                creates a new Houdini scene with the DazToHue network (from your installed
                DazToHue HDA) and <span className="font-mono">Set Project</span> baked in.
              </p>
            </div>

            {houdiniDerived ? (
              <DerivedTarget
                value={settings.houdiniInstallFolder}
                missing="Houdini installation folder"
              >
                Its <code>bin\hython.exe</code> creates the project.
              </DerivedTarget>
            ) : (
              <FolderField
                label="Houdini installation folder (optional)"
                value={settings.houdiniInstallFolder}
                placeholder="C:\Program Files\Side Effects Software\Houdini 22.0.368"
                onChange={(value) => setSettings((s) => ({ ...s, houdiniInstallFolder: value }))}
                help={
                  <>
                    Where Houdini itself is installed — its <code>bin\hython.exe</code> creates
                    the project. Must have a matching Houdini documents folder configured above
                    (prefs are per version: <code>Houdini 22.0.x</code> ↔{' '}
                    <code>houdini22.0</code>).
                  </>
                }
              />
            )}
            {/* The install ↔ documents pairing is load-bearing: hython gets the
                MATCHING docs folder as HOUDINI_USER_PREF_DIR — mismatched, the
                DazToHue otls never load. Warn live; Generate refuses too. */}
            {settings.houdiniInstallFolder.trim() !== '' &&
              !matchingHoudiniDocsFolder(settings.houdiniInstallFolder, [
                settings.houdiniDocsFolder,
                ...settings.extraHoudiniDocsFolders,
              ]) && (
                <p className="text-sm text-destructive">
                  {houdiniVersionFromInstall(settings.houdiniInstallFolder)
                    ? `No matching Houdini documents folder for this install — add "…\\Documents\\houdini${houdiniVersionFromInstall(settings.houdiniInstallFolder)}" above, or Generate project cannot load the DazToHue assets.`
                    : 'No Houdini version found in this path — point it at a versioned install (e.g. "…\\Houdini 22.0.368").'}
                </p>
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
                // …and the mirror of the DTH-releases field above.
                browseFrom={parentDir(settings.dthPosesFolder)}
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

            {/* Same rule as the library above — the active installation IS the
                answer to "which Daz Studio", so the field would be a control
                with nothing to control. The destination shows with the buttons. */}
            {dazDerived ? (
              <DerivedTarget value={settings.dazInstallFolder} missing="Daz Studio install folder">
                The Exporter Plugin DLLs go into its
                <span className="font-mono"> /plugins</span> subfolder.
              </DerivedTarget>
            ) : (
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
            )}

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
                onClick={() =>
                  void runInstall(installDthPlugin, true, setPluginInstalling, setPluginReport)
                }
                disabled={!canInstallPlugin || pluginInstalling}
              >
                {pluginInstalling ? 'Working…' : 'Dry run'}
              </Button>
              <Button
                onClick={() =>
                  void runInstall(
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

          {/* The Runner plugin ships INSIDE the app (fetched from
              polynaut/dth-character-studio-runner at build time) — no source
              folder to pick; only the Daz install folder above matters, and the
              DS4-vs-DS6 DLL is chosen from its DAZStudio exe version. */}
          <section className="space-y-4 rounded-lg border bg-card p-5">
            <div>
              <h2 className="font-semibold">Install DTH Character Studio Runner Plugin</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Runs DTH Export batches in Daz Studio unattended: the plugin polls for the job file
                the character editor's <strong>DTH Export</strong> button writes and works through
                it scene by scene. It ships with this app — installing copies the right DLL (Daz
                Studio 4 vs 6, detected from the install folder above) into Daz Studio's
                <span className="font-mono"> plugins</span> folder.
              </p>
            </div>

            {!settings.dazInstallFolder ? (
              <p className="text-sm text-muted-foreground">
                Set the Daz Studio install folder above to enable the install.
              </p>
            ) : runnerState?.error ? (
              <p className="text-sm text-destructive">{runnerState.error}</p>
            ) : runnerState ? (
              <div className="space-y-1 text-sm text-muted-foreground">
                <p>
                  Bundled Runner{' '}
                  <strong className="text-foreground">{runnerState.bundledVersion || '?'}</strong>
                  {runnerState.flavor && (
                    <> — {runnerState.flavor === 'ds6' ? 'Daz Studio 6' : 'Daz Studio 4'} detected.</>
                  )}
                </p>
                {runnerState.installed === 'none' ? (
                  <p>Not installed in this Daz Studio yet.</p>
                ) : runnerState.installed === 'current' ? (
                  <p className="flex items-center gap-1.5 text-emerald-500">
                    <CircleCheck className="size-4 shrink-0" />
                    Already installed ({runnerState.installedVersion ||
                      runnerState.bundledVersion ||
                      '?'}) — up to date.
                  </p>
                ) : runnerInstalledNewer(runnerState) ? (
                  <p>
                    Installed:{' '}
                    <strong className="text-foreground">{runnerState.installedVersion}</strong> —
                    newer than the bundled Runner; updating would replace it.
                  </p>
                ) : (
                  <p>
                    Installed:{' '}
                    <strong className="text-foreground">
                      {runnerState.installedVersion || 'unknown version'}
                    </strong>{' '}
                    → updating to{' '}
                    <strong className="text-foreground">{runnerState.bundledVersion || '?'}</strong>.
                  </p>
                )}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  void runInstall(installDthRunner, true, setRunnerInstalling, setRunnerReport)
                }
                disabled={!canInstallRunner || runnerInstalling}
              >
                {runnerInstalling ? 'Working…' : 'Dry run'}
              </Button>
              <Button
                onClick={() =>
                  void runInstall(
                    installDthRunner,
                    false,
                    setRunnerInstalling,
                    setRunnerReport,
                    () => void loadRunnerStatus(),
                  )
                }
                disabled={!canInstallRunner || runnerInstalling}
              >
                <Download /> {runnerInstalling ? 'Installing…' : runnerInstallLabel}
              </Button>
            </div>

            {runnerReport && (
              <InstallReportList report={runnerReport} onClose={() => setRunnerReport(null)} />
            )}

            {runnerReport?.steps.some((step) => step.status === 'error') && (
              <p className="text-sm text-destructive">
                Install failed — close all Daz apps and restart DTH Character Studio as
                administrator, then try again. (A running Daz Studio locks its loaded plugin
                DLLs.)
              </p>
            )}
          </section>

          {/* Renders its own card, or nothing when no network drives are
              detected — see NetworkDrivesSection. */}
          <NetworkDrivesSection />
        </TabsContent>

        {/* App Data — the app's own on-disk state: where it lives and how it's
            bounded (housekeeping). */}
        <TabsContent value="appdata" className="space-y-5">
          <section className="space-y-5 rounded-lg border bg-card p-5">
            <div>
              <h2 className="mb-3 flex w-fit items-center gap-1 font-semibold">
                App data folder
                <InfoPopup label="App data folder — more information">
                  Where the app keeps its machine settings, the recent-projects list,
                  network-drive mappings and scan outputs. Project data (characters,
                  avatars) lives in each project's own folder.
                </InfoPopup>
              </h2>
              {appDataFolder ? (
                <PathCode path={displayPath(appDataFolder)} />
              ) : (
                <p className="text-xs text-muted-foreground">Resolving…</p>
              )}
            </div>
          </section>

          <HousekeepingSection />
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
                  <InfoPopup label="Characters subfolder — more information" className="-translate-y-px">
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
                  value={projectSettings.charactersSubdir}
                  placeholder="(project root)"
                  onChange={(e) => patchProject({ charactersSubdir: e.target.value })}
                />
              </div>
              <Field label="Daz scenes subfolder">
                <Input
                  value={projectSettings.dazSubdir}
                  placeholder="daz3d"
                  onChange={(e) => patchProject({ dazSubdir: e.target.value })}
                />
              </Field>
              <Field label="Houdini projects subfolder">
                <Input
                  value={projectSettings.houdiniSubdir}
                  placeholder="houdini"
                  disabled={!projectSettings.createHoudiniSubdir}
                  onChange={(e) => patchProject({ houdiniSubdir: e.target.value })}
                />
              </Field>
              {/* The END of the pipeline — what Houdini generates for Unreal.
                  Not the Daz→Houdini intermediate, which is the fixed
                  `dth-exports` inside the Daz subfolder. */}
              <Field label="Final export subfolder">
                <Input
                  value={projectSettings.exportSubdir}
                  placeholder="export"
                  onChange={(e) => patchProject({ exportSubdir: e.target.value })}
                />
              </Field>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Create the Houdini subfolder in new characters</span>
                <Switch
                  checked={projectSettings.createHoudiniSubdir}
                  onCheckedChange={(v) => patchProject({ createHoudiniSubdir: v })}
                />
              </label>
              <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
                <span className="flex items-center gap-1 font-medium">
                  Enable attachments
                  <InfoPopup label="Enable attachments — more information" className="-translate-y-px">
                    Adds an <strong>Attachments</strong> tab for reusable Daz scenes (bases to build
                    characters on), stored in this project. Off by default — the project then has
                    characters only.{' '}
                    <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/attachments.html#add-an-attachment">
                      Open guide
                    </GuideLink>
                  </InfoPopup>
                </span>
                <Switch
                  checked={projectSettings.assetsEnabled}
                  onCheckedChange={(v) => patchProject({ assetsEnabled: v })}
                />
              </div>
              <div className="flex items-center justify-between gap-3 border-t pt-4 text-sm">
                <span className="flex items-center gap-1 font-medium">
                  Show the Daz Products tab
                  <InfoPopup label="Show the Daz Products tab — more information" className="-translate-y-px">
                    Whether this project's characters get a <strong>Products</strong> tab showing
                    the Daz products each scene uses. It does NOT control the scanning: with a{' '}
                    <strong>DAZ Install Manager manifests folder</strong> set below, every export
                    run scans and the results are filed either way — this only decides whether you
                    see them.{' '}
                    <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/product-scanning.html#daz-product-scanning">
                      Open guide
                    </GuideLink>
                  </InfoPopup>
                </span>
                <Switch
                  checked={projectSettings.dazProductsEnabled}
                  onCheckedChange={(v) => patchProject({ dazProductsEnabled: v })}
                />
              </div>
              {/* Directly under the tab toggle it reads with — this folder is
                  what actually arms the scan, so the two belong together even
                  though only one of them is per-project. */}
              <div>
                {/* Derived with the rest once an installation is active — the
                    manual field and its probe stay for a machine without DIM. */}
                {dazDerived ? (
                  <DerivedFieldNote
                    label="DAZ Install Manager manifests folder"
                    value={settings.dimManifestsFolder}
                  />
                ) : (
                  <>
                    <FolderField
                      label="DAZ Install Manager manifests folder (optional)"
                      value={settings.dimManifestsFolder}
                      placeholder="E:\DAZ 3D\Install Manager\ManifestFiles"
                      onChange={(value) =>
                        setSettings((s) => ({ ...s, dimManifestsFolder: value }))
                      }
                      // No "i" popup here — the Enable-Daz-Products popup above links the
                      // guide, which covers the DIM manifests folder too.
                      help={null}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() => void onDetectDimFolder()}
                      disabled={detectingDim}
                    >
                      {detectingDim ? 'Detecting…' : 'Detect installed location'}
                    </Button>
                  </>
                )}
              </div>
              {/* Last, behind its own rule: the only setting on this tab that
                  changes what GENERATION writes, rather than where the studio
                  keeps things — and the one least often touched. */}
              <div className="border-t pt-4">
                <Label className="mb-1 flex w-fit items-center gap-1">
                  Houdini path style
                  <InfoPopup label="Houdini path style — more information">
                    Bone-scale <strong>reference-skeleton</strong> paths in the PoseAsset CSV are
                    written relative to the scene file — <code>$HIP/../…</code> — so the project
                    keeps resolving after the character tree is moved, renamed, or opened on
                    another machine. Characters with <em>no</em> Houdini project inside their
                    folder get absolute paths regardless.{' '}
                    <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/05-rom-in-daz.html#reference-skeleton-paths--hip-by-default">
                      Open guide
                    </GuideLink>
                  </InfoPopup>
                </Label>
                <Select
                  value={projectSettings.houdiniPathStyle}
                  onValueChange={(value) =>
                    patchProject({ houdiniPathStyle: value === 'absolute' ? 'absolute' : 'hip' })
                  }
                >
                  <SelectTrigger className="w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hip">Relative to the scene file ($HIP) (recommended)</SelectItem>
                    <SelectItem value="absolute">Absolute paths</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </section>
          </TabsContent>
        )}
      </Tabs>
    </main>
  )
}

/**
 * Where an install is about to write, when that destination is DERIVED.
 *
 * A sentence, not a field, and deliberately not a labelled read-only copy: the
 * Daz installation card above already lists these paths, so repeating one here
 * would show the same value twice where it can only ever agree — and put a
 * control where there is no choice left to make. What genuinely belongs next to
 * a Dry run / Install button is the destination, so that is all this is.
 *
 * An empty value is called out instead, because "DIM had nothing for this" is a
 * different problem from "you haven't set it yet" and has a different fix.
 */
function DerivedTarget({
  value,
  missing,
  className = '',
  children,
}: {
  value: string
  /** What DIM had no value for, named in the warning. */
  missing: string
  className?: string
  children?: ReactNode
}) {
  if (!value) {
    return (
      <p className="mt-2 flex items-start gap-1.5 text-sm text-amber-500">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>
          The DAZ Install Manager has no {missing} path, so there is nothing to install into. Use{' '}
          <strong>Set the paths manually</strong> in the Daz installation section to fill it in
          yourself.
        </span>
      </p>
    )
  }
  return (
    <p className={`text-sm text-muted-foreground ${className}`}>
      Installs into <PathCode path={displayPath(value)} />, from the Daz installation above.{' '}
      {children}
    </p>
  )
}

/**
 * A DERIVED path echoed on another tab, where the Daz installation card is not
 * on screen to read it from.
 *
 * Read-only for the same reason the fields it replaces are gone: an editable
 * copy of a derived value is one that can quietly disagree with what produced
 * it. The way to edit it is to stop deriving it — "Set the paths manually", on
 * the General tab.
 */
function DerivedFieldNote({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children?: ReactNode
}) {
  return (
    <div>
      <Label className="mb-1 block">{label}</Label>
      {value ? (
        <p className="text-sm text-muted-foreground">
          <PathCode path={displayPath(value)} />
          {children}
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-sm text-amber-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            The DAZ Install Manager has no value for this. Use{' '}
            <strong>Set the paths manually</strong> above to fill it in yourself.
          </span>
        </p>
      )}
    </div>
  )
}
