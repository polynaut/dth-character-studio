import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '#/components/ui/button.tsx'
import { Switch } from '#/components/ui/switch.tsx'

/**
 * Confirm unlinking an asset (a Daz scene / Houdini project) from a character.
 * The "Delete file on disk" toggle decides whether the underlying file is also
 * removed — the caller defaults it on for files inside the character folder and
 * off for ones linked in place outside it. Esc / backdrop cancel (ignored while
 * busy). Portaled to <body> so a CSS-contained ancestor can't capture it.
 */
export function RemoveAssetDialog({
  title,
  description,
  deleteFile = false,
  onDeleteFileChange,
  showDeleteFile = true,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string
  description: ReactNode
  deleteFile?: boolean
  onDeleteFileChange?: (value: boolean) => void
  /**
   * Show the "Delete file on disk" toggle. Turn it off for assets that are only
   * ever linked in place (e.g. Houdini projects, whose absolute import paths
   * forbid copying) — there, deleting would hit the user's real file, so the
   * action is unlink-only.
   */
  showDeleteFile?: boolean
  busy: boolean
  error?: ReactNode
  onConfirm: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
        {showDeleteFile && onDeleteFileChange && (
          <div className="flex items-center gap-2">
            <Switch checked={deleteFile} onCheckedChange={onDeleteFileChange} />
            <span className="text-sm">Delete file on disk</span>
          </div>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? 'Removing…' : deleteFile ? 'Delete' : 'Unlink'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
