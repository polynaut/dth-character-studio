import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Package, PackageOpen, PaintBucket, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { BulkDeleteDialog } from '#/components/bulk-delete-dialog.tsx'
import { ExportCharacterDialog } from '#/components/character/export-character-dialog.tsx'
import { FillFromCharacterDialog } from '#/components/character/fill-from-character-dialog.tsx'
import { Button } from '@dth/ui'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { characterKeepFolders, deleteCharacter, exportCharacterZip } from '#/lib/rom/api.ts'

import type { Character } from '@dth/rom'

/**
 * The editor's Operations card — the character-level actions and their
 * dialogs: EXPORT (pack the whole character into a `.dcsc.zip`), IMPORT
 * (overwrite this character from such a zip — the flow itself lives in the
 * route's `useImportCharacterZip`, shared with the page-wide drop zone), FILL
 * (the Fill wizard copies ROM sections + extras from another character into
 * the draft; Save decides) and DELETE (the confirm dialog's "keep Daz/Houdini
 * folder" toggles, the on-disk probe gating the Houdini one, and the delete →
 * navigate-home flow).
 */
export function CharacterOperationsSection({
  projectId,
  character,
  patch,
  dazSubdir,
  houdiniSubdir,
  exportSubdir,
  dirty = false,
  onImportRequest,
  bypassUnsavedGuard,
  fillDisabled = false,
}: {
  projectId: string
  character: Character
  /** The draft writer — receives the Fill wizard's patch. */
  patch: (p: Partial<Character>) => void
  /** Scene-less character (locked editor): Fill is pointless before the primary
   *  scene decides the identity — Delete stays available. */
  fillDisabled?: boolean
  /** The project's subfolder names, for the keep-folder + export labels. */
  dazSubdir: string
  houdiniSubdir: string
  exportSubdir: string
  /** Unsaved editor changes — the export dialog warns that the zip is packed
   *  from disk. */
  dirty?: boolean
  /** Opens the Import-zip picker (the route owns the flow + confirm dialog). */
  onImportRequest: () => void
  /** The edited character no longer exists after a delete — a "keep your
   *  changes?" prompt on the navigation away would be nonsense. */
  bypassUnsavedGuard: () => void
}) {
  const router = useRouter()
  const [fillOpen, setFillOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // Whether the character has a Houdini subfolder on disk — gates the delete
  // dialog's "keep Houdini files" toggle (checked when the dialog opens).
  const [keepHoudiniAvailable, setKeepHoudiniAvailable] = useState(false)
  useEffect(() => {
    if (!deleteOpen) return
    let cancelled = false
    void characterKeepFolders({ data: { projectId, id: character.id } })
      .then((f) => !cancelled && setKeepHoudiniAvailable(f.houdini))
      .catch(() => !cancelled && setKeepHoudiniAvailable(false))
    return () => {
      cancelled = true
    }
  }, [deleteOpen, projectId, character.id])

  async function onExportCharacter(opts: { dazExports: boolean; houdiniExports: boolean }) {
    setExporting(true)
    setExportError('')
    try {
      // The folder pick comes AFTER confirming the toggles (Esc there = no
      // export, dialog stays open); packing runs against the picked folder
      // directly — no temp copy to move afterwards.
      const folder = await pickFolder(`Export “${character.name}” — pick a folder for the zip`)
      if (!folder) return
      const { zipPath, report } = await exportCharacterZip({
        data: {
          projectId,
          id: character.id,
          includeDazExports: opts.dazExports,
          includeHoudiniExports: opts.houdiniExports,
          targetFolder: folder,
        },
      })
      setExportOpen(false)
      toast.success(`Exported “${character.name}” (${report.files} files) → ${displayPath(zipPath)}`)
      if (report.skippedLinks > 0) {
        toast.warning(
          `${report.skippedLinks} linked folder(s) inside the character were not packed — links are never followed.`,
        )
      }
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  async function onDeleteCharacter({ keep, keep2 }: { keep: boolean; keep2: boolean }) {
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteCharacter({
        data: { projectId, id: character.id, keepDaz: keep, keepHoudini: keep2 },
      })
      toast.success(`Deleted “${character.name}”`)
      // Navigation unmounts this editor — no need to reset the busy flag. The
      // unsaved-changes guard is bypassed: the edited character no longer exists.
      bypassUnsavedGuard()
      await router.navigate({ to: '/projects/$projectId', params: { projectId } })
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
    }
  }

  return (
    <>
      <section className="mt-8 rounded-lg border border-destructive/30 bg-card p-5">
        <h2 className="mb-1 text-xl font-semibold">Operations</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Export the whole character as a zip (or overwrite it from one), fill the ROM setup from
          another character, or delete this character from the project.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setExportError('')
              setExportOpen(true)
            }}
            disabled={deleting || exporting}
          >
            <Package /> Export
          </Button>
          <Button
            variant="outline"
            onClick={onImportRequest}
            disabled={deleting || exporting}
            title="Restore a character export (.dcsc.zip) OVER this character — or just drop the zip anywhere on this page"
          >
            <PackageOpen /> Import
          </Button>
          <Button
            variant="outline"
            onClick={() => setFillOpen(true)}
            disabled={deleting || fillDisabled}
            title={fillDisabled ? 'Link the primary Daz scene first' : undefined}
          >
            <PaintBucket /> Fill from character
          </Button>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)} disabled={deleting}>
            <Trash2 /> Delete
          </Button>
        </div>
      </section>

      {exportOpen && (
        <ExportCharacterDialog
          characterName={character.name}
          houdiniSubdir={houdiniSubdir}
          exportSubdir={exportSubdir}
          dirty={dirty}
          busy={exporting}
          error={exportError}
          // Fire and forget on purpose — `busy`/`error` are the dialog's channel.
          onConfirm={(opts) => void onExportCharacter(opts)}
          onClose={() => setExportOpen(false)}
        />
      )}

      {fillOpen && (
        <FillFromCharacterDialog
          target={character}
          // Sections + any checked "Also copy" extras — all draft fields; the
          // editor's Save persists (or discards) them like any other edit.
          onFill={patch}
          onClose={() => setFillOpen(false)}
        />
      )}

      {deleteOpen && (
        <BulkDeleteDialog
          noun="character"
          names={[character.name]}
          message="This removes the character folder and its generated files. This cannot be undone."
          keepLabel={
            <>
              Keep the Daz files folder{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{dazSubdir}</code>
            </>
          }
          keep2Label={
            keepHoudiniAvailable ? (
              <>
                Keep the Houdini files folder{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{houdiniSubdir}</code>
              </>
            ) : undefined
          }
          busy={deleting}
          error={deleteError}
          // Fire and forget on purpose — `busy`/`error` are the dialog's channel.
          onConfirm={(opts) => void onDeleteCharacter(opts)}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </>
  )
}
