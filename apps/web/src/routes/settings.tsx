import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { ArrowLeft, FolderOpen, FolderSearch, Save } from 'lucide-react'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { fetchPoseAssets, fetchSettings, saveSettings } from '#/lib/rom/api.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { ROM_SECTIONS, SECTION_LABELS } from '@dth/rom'

import type { DthPoseAsset, GenesisVersion } from '@dth/rom'

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
        <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
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
  assets: Array<DthPoseAsset>
  error: string | null
}

const GENESIS_ORDER: Array<GenesisVersion> = ['G3', 'G8', 'G8.1', 'G9']

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
        Found <strong className="text-foreground">{result.assets.length}</strong> pose presets in{' '}
        <code className="rounded bg-muted px-1.5 py-0.5">{result.folder}</code>
        {unclassified > 0 && <> — {unclassified} could not be classified</>}
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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

  const dirty =
    settings.dazLibraryFolder !== initial.dazLibraryFolder ||
    settings.dazScriptsFolder !== initial.dazScriptsFolder ||
    settings.dthPosesFolder !== initial.dthPosesFolder

  async function onSave() {
    setBusy(true)
    try {
      await saveSettings({ data: settings })
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  async function onScan() {
    setBusy(true)
    try {
      if (dirty) await onSave()
      setScan(await fetchPoseAssets())
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-8">
      <div className="mb-6">
        <Link to="/" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All projects
        </Link>
      </div>
      <header className="mb-8">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Machine-specific folders — stored in the app's private settings file, never committed.
        </p>
      </header>

      <section className="mb-8 space-y-5 rounded-lg border bg-card p-5">
        <FolderField
          label="My DAZ 3D Library"
          value={settings.dazLibraryFolder}
          placeholder="C:\Users\you\Documents\DAZ 3D\Studio\My Library"
          onChange={(value) => setSettings((s) => ({ ...s, dazLibraryFolder: value }))}
          help={
            <>
              Your Daz content library. Used as the default location when adding a project, and
              (in a later update) as the target for generating Daz scripts directly into the
              library for faster testing. Each project's character library is its own folder, set
              per project.
            </>
          }
        />
        <FolderField
          label="Current DTH release folder (or Poses folder)"
          value={settings.dthPosesFolder}
          placeholder="X:\_3d\_resources\_DazToHue\Releases\Release 2.4.3"
          onChange={(value) => setSettings((s) => ({ ...s, dthPosesFolder: value }))}
          help={
            <>
              Accepts a DTH release root (the Poses folder is found inside automatically) or a Poses
              folder directly, e.g. the installed copy in your Daz library. The pose preset catalog
              in the ROM sections is scanned from here — pointing this at a new release makes its
              new presets available immediately, no studio update needed.
            </>
          }
        />
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
        <div className="flex gap-2">
          <Button variant="outline" onClick={onSave} disabled={busy || !dirty}>
            <Save /> {dirty ? 'Save' : 'Saved'}
          </Button>
          <Button onClick={onScan} disabled={busy}>
            <FolderSearch /> Scan DTH release
          </Button>
        </div>
      </section>

      {scan && (
        <section>
          <h2 className="mb-3 text-xl font-semibold">Scan result</h2>
          <ScanSummary result={scan} />
        </section>
      )}
    </main>
  )
}
