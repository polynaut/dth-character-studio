import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, FolderOpen, Save } from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { buildPoseCatalog, fetchSettings, listDthReleases, saveSettings } from '#/lib/rom/api.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { PathCode } from '#/components/path-code.tsx'
import { toast } from 'sonner'
import { ROM_SECTIONS, SECTION_LABELS } from '@dth/rom'

import type { DthPoseAsset, GenesisVersion } from '@dth/rom'
import type { DthReleaseInfo } from '#/lib/rom/api.ts'

/** A folder-path text field with a native "Browse…" picker button. */
function FolderField({
  label,
  value,
  placeholder,
  help,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  help: ReactNode
  onChange: (value: string) => void
}) {
  return (
    <div>
      <Label className="mb-1">{label}</Label>
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
      <p className="mt-1 text-xs text-muted-foreground">{help}</p>
    </div>
  )
}

export const Route = createFileRoute('/settings')({
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

function SettingsPage() {
  const initial = Route.useLoaderData()
  const router = useRouter()
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

  const dirty =
    settings.dazLibraryFolder !== initial.dazLibraryFolder ||
    settings.dazScriptsFolder !== initial.dazScriptsFolder ||
    settings.dthPosesFolder !== initial.dthPosesFolder ||
    settings.currentDthVersion !== initial.currentDthVersion

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

  return (
    <main className="p-8">
      <div className="mb-6">
        <Link to="/" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All projects
        </Link>
      </div>
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
      </header>

      <section className="mb-8 max-w-3xl space-y-5 rounded-lg border bg-card p-5">
        <FolderField
          label="My DAZ 3D Library"
          value={settings.dazLibraryFolder}
          placeholder="C:\Users\you\Documents\DAZ 3D\Studio\My Library"
          onChange={(value) => setSettings((s) => ({ ...s, dazLibraryFolder: value }))}
          help={<>Your Daz content library. Needed as output location for generated Daz scripts.</>}
        />
        <div>
          <FolderField
            label="DTH release or releases folder"
            value={settings.dthPosesFolder}
            placeholder="X:\_3d\_resources\_DazToHue\Releases"
            onChange={(value) => setSettings((s) => ({ ...s, dthPosesFolder: value }))}
            help={
              <>
                Point this at a single DTH release folder (one containing{' '}
                <code className="rounded bg-muted px-1 py-0.5">copyright.txt</code>), or a folder of
                versioned release folders. Zipped releases are listed but must be extracted first.
                For a multi-release folder, choose the version below. Saving caches the pose presets
                for the selected release.
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
          label="DazToHue-Scripts folder"
          value={settings.dazScriptsFolder}
          placeholder="D:\Development\DazToHue-Scripts"
          onChange={(value) => setSettings((s) => ({ ...s, dazScriptsFolder: value }))}
          help={
            <>
              Generated Daz workflow files are also written here, next to DthWorkflow.dsa, so they
              are directly runnable from Daz Studio.
            </>
          }
        />
        <Button onClick={onSave} disabled={busy || !dirty}>
          <Save /> {busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </Button>
      </section>

      {scan && (
        <section>
          <h2 className="mb-3 text-xl font-semibold">Pose catalog</h2>
          <ScanSummary result={scan} />
        </section>
      )}
    </main>
  )
}
