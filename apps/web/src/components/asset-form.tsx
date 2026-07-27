import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'

import { Button, Field, Input, Switch, Textarea } from '@dth/ui'
import { Portrait } from '#/components/portrait.tsx'
import { createAsset } from '#/lib/rom/api.ts'
import { pickDufPath } from '#/lib/desktop.ts'

/** Scene file name without folder or `.duf`, e.g. "X:\…\Kira.duf" → "Kira". */
function sceneStem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? '').replace(/\.duf$/i, '')
}

/**
 * The "Attachment" tab of a create panel: add a Daz scene as a reusable asset
 * (a base to build characters on), stored in `projectId`'s folder. The scene is
 * copied into the project's `.assets` folder (optionally under a subfolder) or
 * linked in place. Calls `onCreated` after a successful add.
 *
 * The picked scene is CONTROLLED: it's the create panel's shared scene state,
 * so a scene chosen on the Character tab is already selected here and a pick
 * made here syncs back (the panel's `onScenePathChange` runs the Character
 * tab's full scene derivation). Only the attachment name/description/copy
 * options are the form's own.
 */
export function AssetForm({
  projectId,
  scenePath,
  onScenePathChange,
  onCreated,
}: {
  projectId: string
  scenePath: string
  onScenePathChange: (path: string) => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [copy, setCopy] = useState(true)
  const [subfolder, setSubfolder] = useState('')
  const [deleteOriginal, setDeleteOriginal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Seed the attachment name from the scene whenever one arrives (mount with a
  // Character-tab pick included) — but never overwrite a name the user typed.
  useEffect(() => {
    if (scenePath) setName((current) => (current.trim() ? current : sceneStem(scenePath)))
  }, [scenePath])

  async function pick() {
    const picked = await pickDufPath('Choose a Daz scene')
    if (picked) onScenePathChange(picked)
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
      toast.success(`Added attachment “${name.trim() || sceneStem(scenePath)}”`)
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
        Add a Daz scene as a reusable <strong>attachment</strong> — a starting point to build
        characters on. Stored in this project.
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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Attachment name" />
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
                Linked in place — the scene stays where it is; this entry just points to it.
              </p>
            )}
          </div>
          <Button onClick={() => void onCreate()} disabled={busy || !name.trim()}>
            {busy ? 'Adding…' : 'Add attachment'}
          </Button>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
