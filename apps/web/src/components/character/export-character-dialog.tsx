import { useState } from 'react'

import { Button, Modal, Switch } from '@dth/ui'

/**
 * The Export operation's dialog: what always travels (the character folder —
 * definition, notes, Daz scenes, Houdini projects — plus the studio's metadata
 * and the avatar) and the two toggles for the regenerable export trees, which
 * can be gigabytes. Confirming first opens the folder picker, then packs —
 * `busy`/`error` are the caller's channel (bulk-delete-dialog convention).
 */
export function ExportCharacterDialog({
  characterName,
  houdiniSubdir,
  exportSubdir,
  dirty = false,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  characterName: string
  /** The project's subfolder names, for the toggle labels. */
  houdiniSubdir: string
  exportSubdir: string
  /** Unsaved editor changes — the zip is packed from disk, so they won't be in it. */
  dirty?: boolean
  busy: boolean
  error: string
  onConfirm: (opts: { dazExports: boolean; houdiniExports: boolean }) => void
  onClose: () => void
}) {
  // Both OFF by default: the export trees are regenerable through the pipeline
  // and routinely the only gigabyte-sized part of a character.
  const [dazExports, setDazExports] = useState(false)
  const [houdiniExports, setHoudiniExports] = useState(false)
  return (
    <Modal open onClose={onClose} title={`Export “${characterName}”`} dismissible={!busy}>
      <p className="text-sm text-muted-foreground">
        Packs the character into a self-contained{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">.dcsc.zip</code>: the definition,
        notes, all Daz scenes, all Houdini project files, the avatar and the studio’s metadata are
        always included. Drop the zip onto a character page to overwrite that character, or onto a
        project page to restore it as a new one.
      </p>
      {dirty && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
          There are unsaved changes — the zip is packed from what’s on disk, so Save first to
          include them.
        </p>
      )}
      <div className="space-y-3 rounded-md border bg-card p-3">
        <div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Include Daz exports{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{houdiniSubdir}/daz-export</code>
            </span>
            <Switch checked={dazExports} onCheckedChange={setDazExports} />
          </label>
          <p className="mt-1.5 text-xs text-muted-foreground">
            The Daz→Houdini intermediate (Alembic caches, reference skeletons) — regenerable with
            DTH Export, and often the largest part by far.
          </p>
        </div>
        <div>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Include Houdini exports{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{exportSubdir}</code>
            </span>
            <Switch checked={houdiniExports} onCheckedChange={setHoudiniExports} />
          </label>
          <p className="mt-1.5 text-xs text-muted-foreground">
            The final export folder — what Houdini generates for Unreal.
          </p>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {/* Fire and forget on purpose — `busy`/`error` are the dialog's channel. */}
        <Button disabled={busy} onClick={() => onConfirm({ dazExports, houdiniExports })}>
          {busy ? 'Packing…' : 'Export…'}
        </Button>
      </div>
    </Modal>
  )
}
