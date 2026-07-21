import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { CircleCheck, Download, Plus } from 'lucide-react'

import { Button, Field, InfoPopup, Input, Label, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from '@dth/ui'
import { FormHeader } from '#/components/form-header.tsx'
import {
  detectDimManifestsFolder,
  fetchActiveProject,
  fetchAppDataFolder,
  fetchPoseAssets,
  fetchSettings,
  installDthPlugin,
  installDthRelease,
  installedExporterVersion,
  listDthExporterReleases,
  listDthReleases,
  rescanPoseAssets,
  saveProjectSettings,
  saveSettings,
} from '#/lib/rom/api.ts'
import { PROJECT_BEHAVIOR_DEFAULTS } from '#/lib/rom/storage.ts'
import { useUnsavedChangesGuard } from '#/lib/use-unsaved-guard.ts'
import { useSettingsActions } from '#/lib/use-settings-actions.ts'
import { useConfirm } from '#/lib/use-confirm.tsx'
import { displayPath } from '#/lib/path.ts'
import { PathCode } from '#/components/path-code.tsx'
import { FolderField, InstallReportList } from '#/components/install-controls.tsx'
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
import type { InstallReport } from '#/lib/rom/api.ts'

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

/**
 * The editable per-project `.dcsp` manifest fields, held on the Project tab as one
 * state object (see {@link SettingsPage}). A new manifest field is added here and
 * flows through patch/dirty/save uniformly — no parallel `useState` to thread.
 */
interface ProjectSettings {
  dazSubdir: string
  houdiniSubdir: string
  createHoudiniSubdir: boolean
  assetsEnabled: boolean
  dazProductsEnabled: boolean
  charactersSubdir: string
}

/** The project's saved values — defaults from THE single copy in
 *  storage/projects (previously re-hardcoded here, free to drift). */
function projectSettingsFrom(project: Partial<ProjectSettings> | null | undefined): ProjectSettings {
  return {
    dazSubdir: project?.dazSubdir ?? PROJECT_BEHAVIOR_DEFAULTS.dazSubdir,
    houdiniSubdir: project?.houdiniSubdir ?? PROJECT_BEHAVIOR_DEFAULTS.houdiniSubdir,
    createHoudiniSubdir:
      project?.createHoudiniSubdir ?? PROJECT_BEHAVIOR_DEFAULTS.createHoudiniSubdir,
    assetsEnabled: project?.assetsEnabled ?? PROJECT_BEHAVIOR_DEFAULTS.assetsEnabled,
    dazProductsEnabled: project?.dazProductsEnabled ?? PROJECT_BEHAVIOR_DEFAULTS.dazProductsEnabled,
    charactersSubdir: project?.charactersSubdir ?? PROJECT_BEHAVIOR_DEFAULTS.charactersSubdir,
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
    charactersSubdir: s.charactersSubdir.trim(),
  }
}

function SettingsPage() {
  const { settings: initial, project } = Route.useLoaderData()
  const router = useRouter()
  const confirm = useConfirm()

  // Reachable from several places, so return to wherever we came from (falling
  // back to the projects home if there's no history to pop) — like the About page.
  function goBack() {
    if (router.history.canGoBack()) router.history.back()
    else void router.navigate({ to: '/' })
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
    const timer = setTimeout(async () => {
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
      // Clear the spinner too (see the releases effect above).
      setExporterLoading(false)
      return
    }
    let cancelled = false
    setExporterLoading(true)
    const timer = setTimeout(async () => {
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

  // Debounced so typing the install path doesn't re-read the DLL on every
  // keystroke (an emptied folder clears immediately). The timer only guards the
  // START of a read — in-flight staleness is the helper's own validity check.
  useEffect(() => {
    if (!settings.dazInstallFolder) {
      void loadInstalledExporter()
      return
    }
    const timer = setTimeout(() => void loadInstalledExporter(), 350)
    return () => clearTimeout(timer)
  }, [settings.dazInstallFolder, loadInstalledExporter])

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
    settings.houdiniDocsFolder !== initial.houdiniDocsFolder ||
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
  const { runInstall } = useSettingsActions({ dirty, settings, baseline: initial })

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
          matching the tab order; General/App Data are machine-wide. */}
      <Tabs defaultValue={project ? 'project' : 'general'} className="max-w-3xl">
        <TabsList>
          {project && <TabsTrigger value="project">Project</TabsTrigger>}
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="appdata">App Data</TabsTrigger>
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
                      setDazReport,
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
                      setHoudiniReport,
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
                      runInstall(
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
                      runInstall(
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
                  <InfoPopup label="Enable attachments — more information">
                    Adds an <strong>Attachments</strong> tab for reusable Daz scenes (bases to build
                    characters on), stored in this project. Off by default — the project then has
                    characters only.
                  </InfoPopup>
                </span>
                <Switch
                  checked={projectSettings.assetsEnabled}
                  onCheckedChange={(v) => patchProject({ assetsEnabled: v })}
                />
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
                <Switch
                  checked={projectSettings.dazProductsEnabled}
                  onCheckedChange={(v) => patchProject({ dazProductsEnabled: v })}
                />
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
