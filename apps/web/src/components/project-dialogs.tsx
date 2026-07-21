import { useState, type ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'

import { Button, Input, Label, Modal } from '@dth/ui'
import { pickFolder } from '#/lib/desktop.ts'
import { displayPath, normalizePathLower } from '#/lib/path.ts'

/** Rename a project — the light operation (just the list entry's name). */
export function ProjectRenameDialog({
  project,
  busy,
  error,
  onSave,
  onClose,
}: {
  project: { name: string }
  busy: boolean
  error?: ReactNode
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(project.name)
  const trimmed = name.trim()
  const submit = () => {
    if (trimmed && !busy) onSave(trimmed)
  }
  return (
    <Modal open onClose={onClose} title="Rename project" dismissible={!busy}>
      <div>
        <Label className="mb-1 block">Name</Label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !trimmed} onClick={submit}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Modal>
  )
}

/**
 * Move a project to a different folder — the heavy operation: all character data
 * is physically moved and every reference repointed. Pick a new folder, confirm.
 */
export function ProjectMoveDialog({
  project,
  busy,
  error,
  onMove,
  onClose,
}: {
  project: { name: string; path: string }
  busy: boolean
  error?: ReactNode
  onMove: (path: string) => void
  onClose: () => void
}) {
  const [path, setPath] = useState(project.path)
  const changed = normalizePathLower(path) !== normalizePathLower(project.path)

  async function choose() {
    const picked = await pickFolder('Choose the new project folder')
    if (picked) setPath(picked)
  }

  return (
    <Modal open onClose={onClose} title="Move project" dismissible={!busy}>
      <p className="text-sm text-muted-foreground">
        Move <span className="font-medium text-foreground">{project.name}</span> and all of its
        character data to a new folder. Scenes linked in place outside the project are left untouched.
      </p>
      <div>
        <Label className="mb-1 block">New folder</Label>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2.5 py-2 font-mono text-xs text-muted-foreground">
            {displayPath(path)}
          </code>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void choose()}>
            <FolderOpen /> Change…
          </Button>
        </div>
        {changed && (
          <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            All character data will be moved to this folder.
          </p>
        )}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy || !changed} onClick={() => onMove(path)}>
          {busy ? 'Moving…' : 'Move'}
        </Button>
      </div>
    </Modal>
  )
}
