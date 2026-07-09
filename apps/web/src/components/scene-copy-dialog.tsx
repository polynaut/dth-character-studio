import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { Button, Input, Label, Switch } from '@dth/ui'

/**
 * The "this Daz scene lives outside — copy it in?" modal, shared by the create
 * flow and the editor's Add-scene flow so they stay identical. A subfolder field
 * (optionally prefixed with a fixed scenes-folder chip), a "Delete original after
 * copying" toggle (which disables "Link in place", since you can't keep the
 * original and delete it), and the two actions. Esc or a backdrop click closes
 * it (both ignored while a copy/move is in flight). Portaled to <body> so a
 * CSS-contained ancestor can't capture its fixed positioning.
 */
export function SceneCopyDialog({
  title,
  description,
  prefix,
  baseValue,
  onBaseChange,
  separator,
  subfolder,
  onSubfolderChange,
  deleteOriginal,
  onDeleteOriginalChange,
  busy,
  error,
  copyLabel,
  onCopy,
  onLink,
  onClose,
}: {
  title: string
  description: ReactNode
  /** A fixed, read-only scenes-folder chip (e.g. "daz3d\") before the subfolder. */
  prefix?: string
  /** An editable scenes-folder base instead of `prefix`: pass `onBaseChange` (and
   *  `separator`) to render it as an input + OS separator before the subfolder. */
  baseValue?: string
  onBaseChange?: (value: string) => void
  separator?: string
  subfolder: string
  onSubfolderChange: (value: string) => void
  deleteOriginal: boolean
  onDeleteOriginalChange: (value: boolean) => void
  busy: boolean
  error?: ReactNode
  copyLabel: string
  onCopy: () => void
  onLink: () => void
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
        <div>
          <Label className="mb-1 block">Subfolder</Label>
          <div className="flex items-center gap-1">
            {onBaseChange ? (
              <>
                <Input
                  className="w-32 shrink-0"
                  value={baseValue ?? ''}
                  placeholder="daz3d"
                  onChange={(e) => onBaseChange(e.target.value)}
                />
                <span className="flex h-9 shrink-0 items-center px-0.5 font-mono text-sm text-muted-foreground">
                  {separator}
                </span>
              </>
            ) : prefix ? (
              <span className="flex h-9 shrink-0 items-center rounded-md border bg-muted px-2.5 font-mono text-xs text-muted-foreground">
                {prefix}
              </span>
            ) : null}
            <Input
              className="flex-1"
              value={subfolder}
              placeholder="e.g. Outfit_Casual"
              onChange={(e) => onSubfolderChange(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={deleteOriginal} onCheckedChange={onDeleteOriginalChange} />
          <span className="text-sm">Delete original after copying</span>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            disabled={busy || deleteOriginal}
            title={deleteOriginal ? 'Disabled while “Delete original” is on' : undefined}
            onClick={onLink}
          >
            Link in place
          </Button>
          <Button disabled={busy} onClick={onCopy}>
            {busy ? (deleteOriginal ? 'Moving…' : 'Copying…') : copyLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
