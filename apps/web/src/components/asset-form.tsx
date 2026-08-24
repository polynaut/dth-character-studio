import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'

import { Button, Field, Input, Switch, Textarea } from '@dth/ui'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { PathCode, tallPathChipClass } from '#/components/path-code.tsx'
import { ScenePreview } from '#/components/scene-preview.tsx'
import houdiniLogo from '#/assets/houdini-logo.svg'
import { createAsset } from '#/lib/rom/api.ts'
import { pickDufPath, pickHipPath } from '#/lib/desktop.ts'
import { browseStart, displayPath } from '#/lib/path.ts'
import type { AssetKind } from '#/lib/rom/storage.ts'

/** File name without folder or extension — "X:\…\Kira.duf" → "Kira". */
function sceneStem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? '').replace(/\.(duf|hip|hipnc|hiplc)$/i, '')
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
  const [kind, setKind] = useState<AssetKind>('daz-scene')
  // The Houdini template path is the form's OWN state, deliberately not the
  // shared `scenePath`: that one is the create panel's Daz scene, wired into the
  // Character tab's scene derivation, and feeding a `.hip` into it would derive
  // a character from a Houdini project.
  const [hipPath, setHipPath] = useState('')
  const [name, setName] = useState(() => (scenePath ? sceneStem(scenePath) : ''))
  const [description, setDescription] = useState('')
  const [copy, setCopy] = useState(true)
  const [subfolder, setSubfolder] = useState('')
  const [deleteOriginal, setDeleteOriginal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Seed the attachment name whenever a scene arrives (the mount case is the
  // useState initializer above) — but never overwrite a name the user typed.
  // Adjusted during render, not in an effect: the seed paints with the scene.
  const [prevScenePath, setPrevScenePath] = useState(scenePath)
  if (scenePath !== prevScenePath) {
    setPrevScenePath(scenePath)
    if (scenePath && !name.trim()) setName(sceneStem(scenePath))
  }

  /** The path this form is actually about, whichever kind is selected. */
  const activePath = kind === 'houdini-project' ? hipPath : scenePath

  async function pick() {
    // Re-picking opens at the file already chosen (preselected), not at
    // wherever the OS last happened to be.
    if (kind === 'houdini-project') {
      const picked = await pickHipPath('Choose a Houdini project', browseStart(hipPath))
      if (picked) {
        setHipPath(picked)
        setName((current) => (current.trim() ? current : sceneStem(picked)))
      }
      return
    }
    const picked = await pickDufPath('Choose a Daz scene', browseStart(scenePath))
    if (picked) onScenePathChange(picked)
  }

  async function onCreate() {
    setBusy(true)
    setError('')
    try {
      const houdini = kind === 'houdini-project'
      await createAsset({
        data: {
          projectId,
          kind,
          scenePath: activePath.trim(),
          name: name.trim(),
          description: description.trim(),
          // A Houdini template is always linked — the api enforces it too.
          subfolder: !houdini && copy ? subfolder.trim() : '',
          copy: !houdini && copy,
          deleteOriginal: !houdini && copy && deleteOriginal,
        },
      })
      toast.success(`Added attachment “${name.trim() || sceneStem(activePath)}”`)
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
        Add a reusable <strong>attachment</strong> to this project — a Daz scene to build
        characters on, or a Houdini project to copy skeleton and material setups from.
      </p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['daz-scene', 'Daz scene', 'A .duf to start a character from'],
            ['houdini-project', 'Houdini template', 'A .hip the Utils drawer copies setups from'],
          ] as const
        ).map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            onClick={() => setKind(value)}
            title={hint}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              kind === value ? 'border-primary bg-primary/10 font-medium' : 'text-muted-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* The same choose-row as the Character tab: button + copyable path chip.
          Dropping is the same action as picking. */}
      <FileDropZone
        accept={kind === 'houdini-project' ? ['hip', 'hipnc', 'hiplc'] : ['duf']}
        label={kind === 'houdini-project' ? 'Drop a Houdini project' : 'Drop a Daz scene'}
        onDrop={(paths) => {
          const dropped = paths[0]
          if (!dropped) return
          if (kind === 'houdini-project') {
            setHipPath(dropped)
            setName((current) => (current.trim() ? current : sceneStem(dropped)))
          } else onScenePathChange(dropped)
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" className="shrink-0" onClick={() => void pick()}>
            <FolderOpen />{' '}
            {activePath
              ? 'Choose another…'
              : kind === 'houdini-project'
                ? 'Choose Houdini project…'
                : 'Choose Daz scene…'}
          </Button>
          {activePath && <PathCode path={displayPath(activePath)} className={tallPathChipClass} />}
        </div>
      </FileDropZone>
      {activePath && (
        <>
          {/* Avatar left; name + the copy options stack beside it (no card) —
              the description follows full-width below the row. */}
          <div className="flex flex-wrap items-start gap-4">
            {kind === 'houdini-project' ? (
              <span className="flex aspect-[3/4] w-24 shrink-0 items-center justify-center rounded-md bg-[#262626]">
                <img src={houdiniLogo} alt="" aria-hidden className="size-10 object-contain" />
              </span>
            ) : (
              <ScenePreview scenePath={scenePath} />
            )}
            <div className="min-w-[20rem] flex-1 space-y-3">
              <Field label="Name">
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Attachment name"
                />
              </Field>
              {kind === 'houdini-project' ? (
                // No copy options at all: a Houdini template is always linked,
                // and offering a switch that the api overrides would be a lie.
                <p className="text-xs text-muted-foreground">
                  Linked in place — a Houdini project is never copied, because moving one safely
                  needs every reference relative <em>and</em> its <code>$JOB</code> folder to
                  travel with it.
                </p>
              ) : (
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  Copy into the{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">.assets</code> folder
                </span>
                <Switch checked={copy} onCheckedChange={setCopy} />
              </label>
              )}
              {kind === 'daz-scene' &&
                (copy ? (
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
                ))}
            </div>
          </div>
          <Field label="Description (optional)">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this base is for…"
              rows={3}
            />
          </Field>
          <div className="flex justify-end">
            <Button onClick={() => void onCreate()} disabled={busy || !name.trim()}>
              {busy ? 'Adding…' : 'Add attachment'}
            </Button>
          </div>
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
