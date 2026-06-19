import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '#/components/ui/button.tsx'
import { Switch } from '#/components/ui/switch.tsx'

/**
 * The "really delete?" confirm for an overview's bulk delete and the character
 * editor's single delete. For characters it offers to keep the Daz / Houdini
 * subfolders on disk; for projects it just clarifies that only the project entry
 * is removed (files are always kept). Esc / backdrop cancel (ignored while busy).
 * Portaled to <body> so a CSS-contained ancestor can't capture its positioning.
 */
export function BulkDeleteDialog({
  noun,
  names,
  showKeepFiles = false,
  dazSubdirLabel = 'daz3d',
  busy,
  error,
  onConfirm,
  onClose,
}: {
  /** Singular item noun, e.g. "project" / "character". */
  noun: string
  /** Names of the items being deleted (drives the heading + preview). */
  names: Array<string>
  /** Characters can keep their Daz scenes folder; projects can't (files kept). */
  showKeepFiles?: boolean
  dazSubdirLabel?: string
  busy: boolean
  error?: ReactNode
  onConfirm: (opts: { keepDaz: boolean }) => void
  onClose: () => void
}) {
  const [keepDaz, setKeepDaz] = useState(false)
  const count = names.length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const heading =
    count === 1
      ? `Delete ${noun} “${names[0]}”?`
      : `Delete ${count} ${noun}s?`
  const preview =
    count > 1 && count <= 8 ? names.join(', ') : count > 8 ? `${names.slice(0, 8).join(', ')}…` : ''

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{heading}</h2>
        {preview && <p className="text-sm text-muted-foreground">{preview}</p>}
        <p className="text-sm text-muted-foreground">
          {showKeepFiles
            ? 'This removes the character folder and its generated files. This cannot be undone.'
            : `This only removes the ${noun} from the list — your files on disk are kept.`}
        </p>
        {showKeepFiles && (
          <label className="flex items-center justify-between gap-3 rounded-md border bg-card p-3 text-sm">
            <span>
              Keep the Daz files folder{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{dazSubdirLabel}</code> on disk
            </span>
            <Switch checked={keepDaz} onCheckedChange={setKeepDaz} />
          </label>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => onConfirm({ keepDaz })}
          >
            {busy ? 'Deleting…' : count === 1 ? 'Delete' : `Delete ${count}`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
