import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { BulkDeleteDialog } from '#/components/bulk-delete-dialog.tsx'
import { deleteAsset, listAssets, openScene } from '#/lib/rom/api.ts'
import type { DazAsset } from '#/lib/rom/storage.ts'

/**
 * The Assets listing for a project (`projectId`). A toolbar (Add + count) over a
 * grid of Daz-scene asset cards, each with open-in-Daz and delete. Reloads when
 * `refreshKey` changes (bumped by the create panel after it adds one). `onAdd`
 * opens that panel on its Asset tab.
 */
export function AssetsGrid({
  projectId,
  refreshKey,
  onAdd,
}: {
  projectId: string
  refreshKey: number
  onAdd: () => void
}) {
  const [assets, setAssets] = useState<Array<DazAsset>>([])
  const [loading, setLoading] = useState(true)
  const [pendingDelete, setPendingDelete] = useState<DazAsset | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setAssets(await listAssets({ data: { projectId } }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  async function confirmDelete({ keep }: { keep: boolean }) {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteAsset({ data: { projectId, id: pendingDelete.id, keepFiles: keep } })
      setPendingDelete(null)
      await reload()
      toast.success('Scene removed')
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus /> Add
        </Button>
        <span className="text-sm text-muted-foreground">
          {assets.length} scene{assets.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading scenes…</p>
      ) : assets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No scenes yet. Add a Daz scene as a reusable base for new characters.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((asset) => (
            <div key={asset.id} className="flex gap-3 rounded-lg border bg-card p-3">
              <Portrait
                scenePath={asset.scenePath}
                name={asset.name}
                className="aspect-[3/4] w-16 shrink-0 rounded-md"
                fallbackClassName="text-2xl"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="truncate font-semibold">{asset.name}</div>
                {asset.description && (
                  <div className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                    {asset.description}
                  </div>
                )}
                <div className="mt-auto flex items-center gap-1 pt-2">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {asset.linked ? 'linked' : asset.subfolder ? `.assets/${asset.subfolder}` : '.assets'}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto size-7"
                    title="Open scene in Daz"
                    onClick={() => void openScene({ data: { scenePath: asset.scenePath } })}
                  >
                    <ExternalLink className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    title="Remove scene"
                    onClick={() => setPendingDelete(asset)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pendingDelete && (
        <BulkDeleteDialog
          noun="scene"
          names={[pendingDelete.name]}
          message={
            pendingDelete.linked
              ? 'This removes the scene from the list. The linked file on disk is left untouched.'
              : 'This removes the scene and its copied files.'
          }
          keepLabel={pendingDelete.linked ? undefined : 'Keep the copied scene files on disk'}
          busy={deleting}
          error={deleteError}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
