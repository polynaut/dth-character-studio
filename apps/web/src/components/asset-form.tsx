import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { Field } from '#/components/field.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { createAsset } from '#/lib/rom/api.ts'
import { pickDufPath } from '#/lib/desktop.ts'

/** Scene file name without folder or `.duf`, e.g. "X:\…\Kira.duf" → "Kira". */
function sceneStem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? '').replace(/\.duf$/i, '')
}

/**
 * The "Asset" tab of a create panel: add a Daz scene as a reusable asset (a base
 * to build characters on), stored in `projectId`'s folder. The scene is copied into
 * the project's `.assets` folder (optionally under a subfolder) or linked in place.
 * Calls `onCreated` after a successful add.
 *
 * `initialScenePath` seeds the picked scene + name (e.g. when a `.duf` was dropped
 * onto the page and the panel opened straight on this tab). Remount the form with a
 * `key` tied to that path so a fresh drop re-seeds it.
 */
export function AssetForm({
  projectId,
  initialScenePath = '',
  onCreated,
}: {
  projectId: string
  initialScenePath?: string
  onCreated: () => void
}) {
  const [scenePath, setScenePath] = useState(initialScenePath)
  const [name, setName] = useState(initialScenePath ? sceneStem(initialScenePath) : '')
  const [description, setDescription] = useState('')
  const [copy, setCopy] = useState(true)
  const [subfolder, setSubfolder] = useState('')
  const [deleteOriginal, setDeleteOriginal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function pick() {
    const picked = await pickDufPath('Choose a Daz scene')
    if (!picked) return
    setScenePath(picked)
    if (!name.trim()) setName(sceneStem(picked))
  }

  async function onCreate() {
    setBusy(true)
    setError('')
    try {
      await createAsset({
        data: {
          projectId,
          scenePath: scenePath.trim(),
          name: name.trim(),
          description: description.trim(),
          subfolder: copy ? subfolder.trim() : '',
          copy,
          deleteOriginal: copy && deleteOriginal,
        },
      })
      toast.success(`Added asset “${name.trim() || sceneStem(scenePath)}”`)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Add a Daz scene as a reusable <strong>asset</strong> — a starting point to build characters
        on. Stored in this project.
      </p>
      <Button variant="outline" onClick={() => void pick()}>
        <FolderOpen /> {scenePath ? 'Choose a different scene…' : 'Choose Daz scene…'}
      </Button>
      {scenePath && (
        <>
          <div className="flex justify-center">
            <Portrait
              scenePath={scenePath}
              name={name || '?'}
              className="aspect-[3/4] w-28 rounded-md"
              fallbackClassName="text-4xl"
            />
          </div>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Asset name" />
          </Field>
          <Field label="Description (optional)">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this base is for…"
              rows={3}
            />
          </Field>
          <div className="space-y-3 rounded-md border bg-card p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                Copy into the <code className="rounded bg-muted px-1 py-0.5 text-xs">.assets</code>{' '}
                folder
              </span>
              <Switch checked={copy} onCheckedChange={setCopy} />
            </label>
            {copy ? (
              <>
                <Field label="Subfolder (optional)">
                  <Input
                    value={subfolder}
                    onChange={(e) => setSubfolder(e.target.value)}
                    placeholder="e.g. bases"
                  />
                </Field>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>Delete the original after copying</span>
                  <Switch checked={deleteOriginal} onCheckedChange={setDeleteOriginal} />
                </label>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Linked in place — the scene stays where it is; the asset just points to it.
              </p>
            )}
          </div>
          <Button onClick={() => void onCreate()} disabled={busy || !name.trim()}>
            {busy ? 'Adding…' : 'Add asset'}
          </Button>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
