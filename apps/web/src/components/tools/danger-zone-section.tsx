import { FolderOpen, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button, InfoPopup, Input } from '@dth/ui'
import { defaultDazUninstallFolders } from '#/lib/rom/api.ts'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { InstallReportList } from '#/components/install-controls.tsx'

import type { InstallReport } from '#/lib/rom/api.ts'

/**
 * "Danger zone" — the Daz uninstall-cleanup section. An editable list of leftover
 * Daz folders (with a "Prefill folder paths" helper) plus a Dry run and a
 * two-step confirmed permanent delete. Owns the in-list folder editing built on
 * `onFoldersChange` (which also resets the report + confirm in the parent); the
 * delete itself and the confirm flag live in the parent.
 */
export function DangerZoneSection({
  folders,
  onFoldersChange,
  busy,
  report,
  onCloseReport,
  confirm,
  onConfirmChange,
  onDryRun,
  onDelete,
}: {
  folders: Array<string>
  onFoldersChange: (folders: Array<string>) => void
  busy: boolean
  report: InstallReport | null
  onCloseReport: () => void
  confirm: boolean
  onConfirmChange: (value: boolean) => void
  onDryRun: () => void
  onDelete: () => void
}) {
  function updateUninstallFolder(i: number, value: string) {
    onFoldersChange(folders.map((f, j) => (j === i ? value : f)))
  }
  function addUninstallFolder() {
    onFoldersChange([...folders, ''])
  }
  function removeUninstallFolder(i: number) {
    onFoldersChange(folders.filter((_, j) => j !== i))
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
      const existing = folders.map((f) => f.trim()).filter(Boolean)
      const merged = [...existing]
      for (const f of found) if (!merged.includes(f)) merged.push(f)
      onFoldersChange(merged)
      toast.success(
        merged.length > existing.length
          ? `Added ${merged.length - existing.length} folder(s)`
          : 'Standard Daz folders already in the list',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
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
        {folders.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No folders yet
          </p>
        )}
        {folders.map((folder, i) => (
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
        <Button variant="outline" onClick={onDryRun} disabled={busy}>
          {busy ? 'Working…' : 'Dry run'}
        </Button>
        {confirm ? (
          <>
            <span className="text-sm font-medium text-destructive">
              Permanently delete {folders.filter((f) => f.trim()).length}{' '}
              folder(s) and all their contents?
            </span>
            <Button
              variant="destructive"
              onClick={onDelete}
              disabled={busy}
            >
              Yes, delete
            </Button>
            <Button variant="outline" onClick={() => onConfirmChange(false)} disabled={busy}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="destructive"
            onClick={() => onConfirmChange(true)}
            disabled={busy || folders.filter((f) => f.trim()).length === 0}
          >
            <Trash2 /> Uninstall Daz
          </Button>
        )}
      </div>
      {report && <InstallReportList report={report} onClose={onCloseReport} />}
    </section>
  )
}
