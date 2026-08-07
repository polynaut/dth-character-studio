import { useEffect, useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { PaintBucket, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { BulkDeleteDialog } from '#/components/bulk-delete-dialog.tsx'
import { FillFromCharacterDialog } from '#/components/character/fill-from-character-dialog.tsx'
import { Button } from '@dth/ui'
import { characterKeepFolders, deleteCharacter } from '#/lib/rom/api.ts'

import type { Character } from '@dth/rom'

/**
 * The editor's Operations card — the character-level actions and their
 * dialogs: FILL (the Fill wizard copies ROM sections + extras from another
 * character into the draft; Save decides) and DELETE (the confirm dialog's
 * "keep Daz/Houdini folder" toggles, the on-disk probe gating the Houdini
 * one, and the delete → navigate-home flow).
 */
export function CharacterOperationsSection({
  projectId,
  character,
  patch,
  dazSubdir,
  houdiniSubdir,
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
  /** The project's subfolder names, for the keep-folder labels. */
  dazSubdir: string
  houdiniSubdir: string
  /** The edited character no longer exists after a delete — a "keep your
   *  changes?" prompt on the navigation away would be nonsense. */
  bypassUnsavedGuard: () => void
}) {
  const router = useRouter()
  const [fillOpen, setFillOpen] = useState(false)
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
          Fill the ROM setup from another character, or delete this character from the project.
        </p>
        <div className="flex flex-wrap gap-3">
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
