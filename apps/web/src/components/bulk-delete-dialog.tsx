import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '#/components/ui/button.tsx'
import { Switch } from '#/components/ui/switch.tsx'

/**
 * The "really delete?" confirm for an overview's bulk delete and the character
 * editor's single delete. `message` is the (destructive) description. When
 * `keepLabel` is set, a single "keep on disk" toggle is shown — OFF by default,
 * so the default action deletes the files; turning it on opts out. The chosen
 * value is reported as `{ keep }`. Esc / backdrop cancel (ignored while busy).
 * Portaled to <body> so a CSS-contained ancestor can't capture its positioning.
 */
export function BulkDeleteDialog({
  noun,
  names,
  message,
  keepLabel,
  keepNote,
  keep2Label,
  keep2Note,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  /** Singular item noun, e.g. "project" / "character". */
  noun: string
  /** Names of the items being deleted (drives the heading + preview). */
  names: Array<string>
  /** The description line under the heading (what deleting does). */
  message: ReactNode
  /** Label for the optional "keep files on disk" toggle; omit for no toggle. */
  keepLabel?: ReactNode
  /** Extra clarification shown under the toggle. */
  keepNote?: ReactNode
  /** Label for an optional SECOND "keep" toggle (e.g. a Houdini subfolder); omit
   *  for none. Its value is reported as `keep2`. */
  keep2Label?: ReactNode
  /** Extra clarification shown under the second toggle. */
  keep2Note?: ReactNode
  busy: boolean
  error?: ReactNode
  onConfirm: (opts: { keep: boolean; keep2: boolean }) => void
  onClose: () => void
}) {
  const [keep, setKeep] = useState(false)
  const [keep2, setKeep2] = useState(false)
  const count = names.length

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const heading = count === 1 ? `Delete ${noun} “${names[0]}”?` : `Delete ${count} ${noun}s?`
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
        <p className="text-sm text-muted-foreground">{message}</p>
        {(keepLabel || keep2Label) && (
          <div className="space-y-3 rounded-md border bg-card p-3">
            {keepLabel && (
              <div>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>{keepLabel}</span>
                  <Switch checked={keep} onCheckedChange={setKeep} />
                </label>
                {keepNote && <p className="mt-1.5 text-xs text-muted-foreground">{keepNote}</p>}
              </div>
            )}
            {keep2Label && (
              <div>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>{keep2Label}</span>
                  <Switch checked={keep2} onCheckedChange={setKeep2} />
                </label>
                {keep2Note && <p className="mt-1.5 text-xs text-muted-foreground">{keep2Note}</p>}
              </div>
            )}
          </div>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => onConfirm({ keep, keep2 })}>
            {busy ? 'Deleting…' : count === 1 ? 'Delete' : `Delete ${count}`}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
