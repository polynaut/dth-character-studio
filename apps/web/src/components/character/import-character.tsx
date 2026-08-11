import { useState } from 'react'
import { toast } from 'sonner'

import { Button, Modal } from '@dth/ui'
import { pickZipPath } from '#/lib/desktop.ts'
import { importCharacterZip, readCharacterZipManifest } from '#/lib/rom/api.ts'

import type { Character } from '@dth/rom'
import type { CharacterZipManifest } from '#/lib/rom/api.ts'

/**
 * The whole Import-from-zip flow as ONE hook, shared by its two entry points:
 * the character page (Import button + page-wide zip drop → OVERWRITE that
 * character) and the project page (page-wide zip drop → CREATE a new
 * character). Validates the zip's manifest before showing the confirm dialog,
 * runs the import, surfaces every warning the import couldn't fix silently
 * (Houdini paths, regeneration), then hands the imported character to
 * `onImported` for navigation/remount.
 */
export function useImportCharacterZip(opts: {
  projectId: string
  /** Overwrite mode: the character this page shows. Null = create mode. */
  target: { id: string; name: string } | null
  onImported: (character: Character) => void | Promise<void>
}) {
  const [pending, setPending] = useState<{
    zipPath: string
    manifest: CharacterZipManifest
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function openZip(zipPath: string) {
    try {
      const manifest = await readCharacterZipManifest({ data: { zipPath } })
      setError('')
      setPending({ zipPath, manifest })
    } catch (e) {
      // A foreign/newer zip never opens the dialog — the reason is the message.
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  async function openPicker() {
    const picked = await pickZipPath('Select a character export (.dcsc.zip)')
    if (picked) await openZip(picked)
  }

  async function onConfirm() {
    if (!pending) return
    setBusy(true)
    setError('')
    try {
      const result = await importCharacterZip({
        data: {
          projectId: opts.projectId,
          zipPath: pending.zipPath,
          mode: opts.target ? 'overwrite' : 'create',
          targetId: opts.target?.id,
        },
      })
      setPending(null)
      toast.success(
        opts.target
          ? `Imported “${result.character.name}” over “${opts.target.name}”`
          : `Imported “${result.character.name}”`,
      )
      // Longer-lived than a success blip: each names something the import could
      // NOT fix and what to do about it.
      for (const warning of result.warnings) toast.warning(warning, { duration: 15000 })
      await opts.onImported(result.character)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const dialog = pending ? (
    <ImportCharacterDialog
      manifest={pending.manifest}
      targetName={opts.target?.name ?? null}
      busy={busy}
      error={error}
      onConfirm={() => void onConfirm()}
      onClose={() => {
        if (!busy) setPending(null)
      }}
    />
  ) : null

  return {
    openPicker: () => void openPicker(),
    openZip: (zipPath: string) => void openZip(zipPath),
    dialog,
  }
}

/** `2026-08-11T…` → a local date-time, or the raw string when unparsable. */
function exportedAtLabel(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

function ImportCharacterDialog({
  manifest,
  targetName,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  manifest: CharacterZipManifest
  /** Non-null = overwrite mode (the destructive one). */
  targetName: string | null
  busy: boolean
  error: string
  onConfirm: () => void
  onClose: () => void
}) {
  const overwrite = targetName !== null
  const exportedAt = exportedAtLabel(manifest.exportedAt)
  const includes = [
    manifest.includes.dazExports ? 'Daz exports included' : 'no Daz exports',
    manifest.includes.houdiniExports ? 'Houdini exports included' : 'no Houdini exports',
  ].join(', ')
  return (
    <Modal
      open
      onClose={onClose}
      title={overwrite ? `Overwrite “${targetName}”?` : `Import “${manifest.characterName}”`}
      dismissible={!busy}
    >
      <p className="text-sm text-muted-foreground">
        {overwrite ? (
          <>
            This replaces <strong>{targetName}</strong> completely with the zip’s character —
            scenes, Houdini projects, exports, notes, metadata and avatar. The current character’s
            files are deleted first. This cannot be undone.
          </>
        ) : (
          <>Restores the zip’s character — with all of its data — as a new character of this project.</>
        )}
      </p>
      <div className="space-y-1 rounded-md border bg-card p-3 text-sm">
        <div>
          <span className="text-muted-foreground">Character:</span> {manifest.characterName}
        </div>
        {exportedAt && (
          <div>
            <span className="text-muted-foreground">Exported:</span> {exportedAt}
            {manifest.sourceProjectName ? ` — from “${manifest.sourceProjectName}”` : ''}
          </div>
        )}
        <div className="text-xs text-muted-foreground">{includes}</div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        {/* Fire and forget on purpose — `busy`/`error` are the dialog's channel. */}
        <Button variant={overwrite ? 'destructive' : 'default'} disabled={busy} onClick={onConfirm}>
          {busy ? 'Importing…' : overwrite ? 'Overwrite' : 'Import'}
        </Button>
      </div>
    </Modal>
  )
}
