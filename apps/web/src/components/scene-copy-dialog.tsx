import type { ReactNode } from 'react'

import { Button, Input, Label, Modal, Switch } from '@dth/ui'

import { PathCode, tallPathChipClass } from '#/components/path-code.tsx'
import { displayPath } from '#/lib/path.ts'

/**
 * The "this Daz scene lives outside — copy it in?" modal of the editor's
 * Add-scene flow (creating a character decides copy-vs-link right in its
 * panel — no modal detour there). A subfolder field (prefixed with the fixed
 * scenes-folder chip), a "Delete original after copying" toggle (which
 * disables "Link in place", since you can't keep the original and delete it),
 * and the two actions. Built on the Modal primitive (focus trap + dialog
 * semantics; Esc/backdrop close, ignored while a copy/move is in flight).
 */
export function SceneCopyDialog({
  title,
  description,
  filePath,
  prefix,
  subfolder,
  onSubfolderChange,
  deleteOriginal,
  onDeleteOriginalChange,
  busy,
  error,
  copyLabel,
  validation,
  confirmDisabled = false,
  confirmDisabledTitle,
  requireSubfolder = false,
  onCopy,
  onLink,
  onClose,
  className,
  extra,
}: {
  title: string
  description: ReactNode
  /** The full path of the picked scene, shown as a copyable chip so the user can
   *  confirm which file they selected before copying it in. */
  filePath?: string
  /** A fixed, read-only scenes-folder chip (e.g. "daz3d\") before the subfolder. */
  prefix?: string
  subfolder: string
  onSubfolderChange: (value: string) => void
  deleteOriginal: boolean
  onDeleteOriginalChange: (value: boolean) => void
  busy: boolean
  error?: ReactNode
  copyLabel: string
  /** Extra block between the file chip and the subfolder — the Add-scene flow
   *  slots its Validation table here. */
  validation?: ReactNode
  /** Disables BOTH confirm actions (Copy & Link in place) — the Add-scene flow
   *  gates them on its validation (checks failed / still running). */
  confirmDisabled?: boolean
  /** Native tooltip on the disabled confirm actions saying why. */
  confirmDisabledTitle?: string
  /** Require a non-empty subfolder for the COPY action (every scene lives in
   *  its own subfolder now); Link in place stays available — a linked-in-place
   *  scene has no in-project folder to name. */
  requireSubfolder?: boolean
  onCopy: () => void
  onLink: () => void
  onClose: () => void
  /** Extra classes for the modal card (e.g. a wider max width). */
  className?: string
  /** Extra block after the delete-original row — the replace-primary flow
   *  slots its "Delete the old primary scene file" decision here. */
  extra?: ReactNode
}) {
  return (
    <Modal open onClose={onClose} title={title} dismissible={!busy} className={className}>
      <p className="text-sm text-muted-foreground">{description}</p>
        {filePath ? (
          <div>
            <Label className="mb-1 block">Selected file</Label>
            <PathCode path={displayPath(filePath)} className={tallPathChipClass} />
          </div>
        ) : null}
        {validation}
        <div>
          <Label className="mb-1 block">Subfolder</Label>
          <div className="flex items-center gap-1">
            {prefix ? (
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
        {extra}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={busy || deleteOriginal || confirmDisabled}
            title={
              confirmDisabled
                ? confirmDisabledTitle
                : deleteOriginal
                  ? 'Disabled while “Delete original” is on'
                  : undefined
            }
            onClick={onLink}
          >
            Link in place
          </Button>
          <Button
            disabled={busy || confirmDisabled || (requireSubfolder && subfolder.trim() === '')}
            title={
              confirmDisabled
                ? confirmDisabledTitle
                : requireSubfolder && subfolder.trim() === ''
                  ? 'Enter a subfolder — every scene lives in its own subfolder now'
                  : undefined
            }
            onClick={onCopy}
          >
            {busy ? (deleteOriginal ? 'Moving…' : 'Copying…') : copyLabel}
          </Button>
        </div>
    </Modal>
  )
}
