import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { Switch } from '#/components/ui/switch.tsx'

/**
 * The "clone this character" dialog: choose the copy's name (pre-filled
 * "<name> copy") and whether to bring its Daz scenes across. Local scenes (in
 * the character folder) are copied into the copy; linked scenes are kept as
 * references with their files untouched. The scenes toggle is hidden when the
 * source has none. Esc / backdrop cancel (ignored while busy). Portaled to
 * <body> so a CSS-contained ancestor can't capture its positioning.
 */
export function CloneCharacterDialog({
  defaultName,
  hasScenes,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  defaultName: string
  /** Whether the source has any Daz scenes — gates the "Copy Daz scenes" toggle. */
  hasScenes: boolean
  busy: boolean
  error?: ReactNode
  onConfirm: (opts: { name: string; copyScenes: boolean }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(defaultName)
  const [copyScenes, setCopyScenes] = useState(true)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const trimmed = name.trim()
  const submit = () => {
    if (trimmed && !busy) onConfirm({ name: trimmed, copyScenes: hasScenes && copyScenes })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Clone character</h2>
        <div>
          <Label className="mb-1 block">New name</Label>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        {hasScenes && (
          <div>
            <div className="flex items-center gap-2">
              <Switch checked={copyScenes} onCheckedChange={setCopyScenes} />
              <span className="text-sm">Copy Daz scenes</span>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Scenes stored in the character folder are copied into the copy; scenes linked in
              place are kept as links — their files are left untouched.
            </p>
          </div>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !trimmed} onClick={submit}>
            {busy ? 'Cloning…' : 'Clone'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
