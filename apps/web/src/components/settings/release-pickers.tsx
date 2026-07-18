import { Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@dth/ui'

import type { DthExporterReleaseInfo, DthReleaseInfo } from '#/lib/rom/api.ts'

/** What the Settings page knows about the DTH releases in the configured folder. */
export interface ReleasesState {
  mode: 'single' | 'multi' | 'none'
  version: string
  releases: Array<DthReleaseInfo>
  error: string | null
}

/** Same, for the DTH Exporter Plugin folder (version read from the DLL). */
export interface ExporterReleasesState {
  mode: 'single' | 'multi' | 'none'
  version: string
  releases: Array<DthExporterReleaseInfo>
  error: string | null
}

/**
 * Under the DTH folder field: nothing for an empty folder, the detected version
 * for a single release, or a version dropdown when the folder holds several.
 */
export function ReleasePicker({
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
export function ExporterReleasePicker({
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
