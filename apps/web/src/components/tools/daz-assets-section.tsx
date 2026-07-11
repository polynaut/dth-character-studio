import { Download, FolderOpen, Plus, X } from 'lucide-react'

import { Button, Input } from '@dth/ui'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { InstallReportList } from '#/components/install-controls.tsx'

import type { InstallReport } from '#/lib/rom/api.ts'

/**
 * The "Daz assets" install section: an editable list of the user's own asset
 * source folders plus Scan / Dry run / Install actions. Presentational — the
 * folder list and install verdict (`changedAssets`) live in the parent; this
 * owns only the in-list add/update/remove/browse editing built on `onFoldersChange`.
 */
export function DazAssetsSection({
  folders,
  onFoldersChange,
  busy,
  report,
  onCloseReport,
  changedAssets,
  onScan,
  onDryRun,
  onInstall,
}: {
  folders: Array<string>
  onFoldersChange: (folders: Array<string>) => void
  busy: boolean
  report: InstallReport | null
  onCloseReport: () => void
  changedAssets: Array<string>
  onScan: () => void
  onDryRun: () => void
  onInstall: () => void
}) {
  function addAssetFolder() {
    onFoldersChange([...folders, ''])
  }
  function updateAssetFolder(i: number, value: string) {
    onFoldersChange(folders.map((f, j) => (j === i ? value : f)))
  }
  function removeAssetFolder(i: number) {
    onFoldersChange(folders.filter((_, j) => j !== i))
  }
  async function browseAssetFolder(i: number) {
    const picked = await pickFolder('Daz assets folder')
    if (picked) updateAssetFolder(i, picked)
  }

  return (
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
        {folders.length === 0 && (
          <p className="text-sm text-muted-foreground">No asset folders yet.</p>
        )}
        {folders.map((folder, i) => (
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
        <Button variant="outline" onClick={onScan} disabled={busy}>
          {busy ? 'Working…' : 'Scan'}
        </Button>
        <Button variant="outline" onClick={onDryRun} disabled={busy}>
          Dry run
        </Button>
        <Button
          onClick={onInstall}
          disabled={busy}
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
      {report && <InstallReportList report={report} onClose={onCloseReport} />}
    </section>
  )
}
