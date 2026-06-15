import { useRef, useState } from 'react'
import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ArrowLeft,
  Download,
  FolderInput,
  Pencil,
  Plus,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'

import { Avatar } from '#/components/avatar.tsx'
import { EditableTitle } from '#/components/editable-title.tsx'
import { toast } from 'sonner'
import { RomSections } from '#/components/rom-sections.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import { Switch } from '#/components/ui/switch.tsx'
import { Textarea } from '#/components/ui/textarea.tsx'
import {
  fetchCharacter,
  fetchPoseAssets,
  fetchSettings,
  generateCharacterFiles,
  getCharacterPath,
  moveCharacter,
  saveCharacter,
  uploadCharacterImage,
} from '#/lib/rom/api.ts'
import { characterSkinning, countPoses, jcmMorphModSchema } from '@dth/rom'

import type { CharacterLocation } from '#/lib/rom/api.ts'
import type { GeneratedFile } from '@dth/rom'
import type { Character, GenesisVersion, TargetSkeleton } from '@dth/rom'

export const Route = createFileRoute('/projects/$projectId/characters/$characterId')({
  loader: async ({ params }) => {
    const { projectId, characterId: id } = params
    const character = await fetchCharacter({ data: { projectId, id } })
    if (!character) throw notFound()
    const [settings, catalog, location] = await Promise.all([
      fetchSettings(),
      fetchPoseAssets(),
      getCharacterPath({ data: { projectId, id } }),
    ])
    return { character, settings, catalog, location }
  },
  component: CharacterPage,
})

interface GenerateResult {
  outDir: string
  files: Array<GeneratedFile>
  dazScriptsFolder: string | null
  dazScriptsError: string | null
}

function NumberField({
  value,
  onCommit,
  className,
}: {
  value: number
  onCommit: (value: number) => void
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  return (
    <Input
      className={className}
      value={draft}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = Number(draft)
        if (!Number.isNaN(parsed)) onCommit(parsed)
        else setDraft(String(value))
      }}
    />
  )
}

function JcmModsEditor({
  value,
  onCommit,
}: {
  value: Character['jcmMorphMods']
  onCommit: (mods: Character['jcmMorphMods']) => void
}) {
  const [draft, setDraft] = useState(JSON.stringify(value, null, 2))
  const [error, setError] = useState('')
  return (
    <div>
      <Textarea
        className="min-h-32 font-mono text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          try {
            const parsed = z.array(jcmMorphModSchema).parse(JSON.parse(draft))
            setError('')
            onCommit(parsed)
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          }
        }}
      />
      {error && <p className="mt-1 text-xs text-destructive">Invalid: {error}</p>}
      <p className="mt-1 text-xs text-muted-foreground">
        JSON array of {'{'} boneLabel, axis, positive[], negative[] {'}'} — drives morphs
        proportionally to bone rotations across the JCM ROM.
      </p>
    </div>
  )
}

/**
 * Avatar edit dialog: shows the current image, accepts an external image URL,
 * or a drag-and-dropped (or picked) image file which is stored under
 * <data>/images/ and referenced by filename (see lib/rom/image).
 */
function ImageDialog({
  image,
  name,
  characterId,
  onApply,
  onClose,
}: {
  image: string
  name: string
  characterId: string
  onApply: (image: string) => void | Promise<void>
  onClose: () => void
}) {
  const [url, setUrl] = useState(image)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  async function uploadFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Not an image file.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image is larger than 10 MB.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read the file'))
        reader.readAsDataURL(file)
      })
      const served = await uploadCharacterImage({
        data: {
          characterId,
          mimeType: file.type,
          dataBase64: dataUrl.split(',')[1] ?? '',
        },
      })
      setUrl(served)
      onApply(served)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Character image</h2>
          <Button variant="ghost" size="icon" className="size-7" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>

        <div className="flex justify-center">
          <Avatar
            image={url}
            name={name}
            className="size-40 rounded-lg"
            fallbackClassName="text-5xl"
          />
        </div>

        <div
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
            dragOver ? 'border-primary bg-primary/5 text-foreground' : 'border-input text-muted-foreground'
          }`}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files[0]
            if (file) uploadFile(file)
          }}
        >
          {busy ? 'Uploading…' : 'Drop an image here, or click to pick one'}
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={url}
            placeholder="Paste an image URL (https://…)"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onApply(url)
                onClose()
              }
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              onApply(url)
              onClose()
            }}
          >
            Apply
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) uploadFile(file)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/** Shows where a character's folder lives and lets the user move it within the library. */
function StorageLocation({
  projectId,
  id,
  location,
}: {
  projectId: string
  id: string
  location: CharacterLocation | null
}) {
  const router = useRouter()
  const [relPath, setRelPath] = useState(() => {
    if (!location) return ''
    const fn = location.definitionAbs.split(/[\\/]/).pop() ?? ''
    return location.relFolder ? `${location.relFolder}/${fn}` : fn
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!location) return null
  const fileName = location.definitionAbs.split(/[\\/]/).pop() ?? ''
  const currentPath = location.relFolder ? `${location.relFolder}/${fileName}` : fileName
  const moved = relPath.trim() !== currentPath

  async function onMove() {
    if (busy || !moved || !relPath.trim()) return
    setBusy(true)
    setError('')
    try {
      await moveCharacter({ data: { projectId, id, relPath: relPath.trim() } })
      await router.invalidate()
      toast.success(`Moved to ${relPath.trim()}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <Label className="mb-1 block">Path in project</Label>
      <div className="flex items-center gap-2">
        <span
          className="shrink-0 rounded-md border bg-muted px-2.5 py-2 font-mono text-xs text-muted-foreground"
          title={location.libraryFolder}
        >
          library /
        </span>
        <Input
          value={relPath}
          placeholder="ElectraTest/ElectraTest.json"
          onChange={(e) => setRelPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void onMove()
            }
          }}
        />
        <Button
          variant="outline"
          className="shrink-0"
          onClick={onMove}
          disabled={busy || !moved || !relPath.trim()}
        >
          <FolderInput /> Move
        </Button>
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}

function CharacterPage() {
  const { projectId } = Route.useParams()
  const { character: initial, settings, catalog, location } = Route.useLoaderData()
  const router = useRouter()
  // The page owns a draft copy; "Save" persists it and revalidates the loader.
  const [character, setCharacter] = useState<Character>(initial)
  const [saving, setSaving] = useState(false)
  const [generated, setGenerated] = useState<GenerateResult | null>(null)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const swallowNavRef = useRef(false)

  const dirty = JSON.stringify(character) !== JSON.stringify(initial)

  function patch(p: Partial<Character>) {
    setCharacter((c) => ({ ...c, ...p }))
  }

  // Inline rename from the title — persists immediately (like the avatar) so the
  // new name + folder rename stick without needing the Save button.
  async function onRenameCharacter(next: string) {
    const updated = { ...character, name: next }
    setCharacter(updated)
    const saved = await saveCharacter({ data: { projectId, character: updated } })
    setCharacter(saved)
    await router.invalidate()
    toast.success(`Renamed to “${next}”`)
  }

  // Saving also (re)generates all DTH files in the same step.
  async function onSave() {
    setSaving(true)
    try {
      const saved = await saveCharacter({ data: { projectId, character } })
      setCharacter(saved) // reconcile the draft (incl. new updatedAt) so it's no longer "dirty"
      const result = await generateCharacterFiles({ data: { projectId, id: saved.id } })
      setGenerated(result)
      await router.invalidate()
      toast.success(`Saved “${saved.name}” and generated ${result.files.length} files`)
      if (result.dazScriptsError) {
        toast.warning(`Couldn't write to the DazToHue-Scripts folder: ${result.dazScriptsError}`)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function onDiscard() {
    setCharacter(initial)
  }

  function download(file: GeneratedFile) {
    const blob = new Blob([file.content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <Link
          to="/projects/$projectId"
          params={{ projectId }}
          onMouseDown={() => {
            swallowNavRef.current = editingTitle
          }}
          onClick={(e) => {
            if (swallowNavRef.current) {
              e.preventDefault()
              swallowNavRef.current = false
            }
          }}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to project
        </Link>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onDiscard} disabled={saving || !dirty}>
            <Undo2 /> Discard
          </Button>
          <Button onClick={onSave} disabled={saving || !dirty}>
            <Save /> {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </Button>
        </div>
      </div>

      <header className="mb-8 flex items-center gap-5">
        <button
          type="button"
          className="group relative shrink-0"
          title="Edit the character image"
          onClick={() => setImageDialogOpen(true)}
        >
          <Avatar
            image={character.image}
            name={character.name}
            className="size-20 rounded-lg"
            fallbackClassName="text-3xl"
          />
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Pencil className="size-5 text-white" />
          </span>
        </button>
        <div>
          <EditableTitle
            name={character.name}
            ariaLabel="Character name"
            onEditingChange={setEditingTitle}
            onSave={onRenameCharacter}
          />
          <p className="text-muted-foreground">
            {character.genesis} · {characterSkinning(character).toUpperCase()} ·{' '}
            {countPoses(character.sections)} custom ROM frames
          </p>
        </div>
      </header>

      <section className="mb-8 grid grid-cols-1 gap-6 rounded-lg border bg-card p-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <Label className="mb-1">Name</Label>
            <Input value={character.name} onChange={(e) => patch({ name: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <Label className="mb-1">Genesis</Label>
              <Select
                value={character.genesis}
                onValueChange={(v) => patch({ genesis: v as GenesisVersion })}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="G9">G9</SelectItem>
                  <SelectItem value="G8.1" disabled>
                    G8.1 — later
                  </SelectItem>
                  <SelectItem value="G8" disabled>
                    G8 — later
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1">Gender</Label>
              <Select
                value={character.gender}
                onValueChange={(v) => patch({ gender: v as Character['gender'] })}
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1">Target skeleton</Label>
              <Select
                value={character.targetSkeleton}
                onValueChange={(v) => patch({ targetSkeleton: v as TargetSkeleton })}
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="UE5">UE5 Mannequin</SelectItem>
                  <SelectItem value="DTH">DTH native</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex gap-4">
            <div>
              <Label className="mb-1" title="G9 FACS Detail Strength, set at frame 0">
                FACS detail strength
              </Label>
              <NumberField
                className="w-28"
                value={character.facsDetailStrength}
                onCommit={(facsDetailStrength) => patch({ facsDetailStrength })}
              />
            </div>
            <div>
              <Label className="mb-1" title="G9 Flexion Automatic Strength, set at frame 0">
                Flexion strength
              </Label>
              <NumberField
                className="w-28"
                value={character.flexionStrength}
                onCommit={(flexionStrength) => patch({ flexionStrength })}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={character.resetGPBeforeApplying}
              onCheckedChange={(resetGPBeforeApplying) => patch({ resetGPBeforeApplying })}
            />
            <span className="text-sm">Reset GP before applying extra frames</span>
          </div>
        </div>
      </section>

      <details className="mb-8 rounded-lg border bg-card">
        <summary className="cursor-pointer px-5 py-3 font-medium select-none">
          Advanced options
        </summary>
        <div className="space-y-6 border-t p-5">
          <StorageLocation projectId={projectId} id={character.id} location={location} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-5">
            <div>
              <Label className="mb-2 block">Preserve morphs after ROM loading</Label>
              {character.preserveMorphs.map((morph, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <Input
                    value={morph.name}
                    placeholder="body_ctrl_BreastsUp-Down"
                    onChange={(e) =>
                      patch({
                        preserveMorphs: character.preserveMorphs.map((m, mi) =>
                          mi === i ? { ...m, name: e.target.value } : m,
                        ),
                      })
                    }
                  />
                  <NumberField
                    className="w-24"
                    value={morph.keepValue}
                    onCommit={(keepValue) =>
                      patch({
                        preserveMorphs: character.preserveMorphs.map((m, mi) =>
                          mi === i ? { ...m, keepValue } : m,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={() =>
                      patch({ preserveMorphs: character.preserveMorphs.filter((_, mi) => mi !== i) })
                    }
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  patch({ preserveMorphs: [...character.preserveMorphs, { name: '', keepValue: 1 }] })
                }
              >
                <Plus /> Add morph
              </Button>
            </div>
            <div>
              <Label className="mb-2 block">Preserve node transforms (e.g. eyes)</Label>
              {character.preserveNodeTransforms.map((transform, i) => (
                <div key={i} className="mb-2 flex items-center gap-2">
                  <Input
                    value={transform.nodeLabel}
                    placeholder="Left Eye"
                    onChange={(e) =>
                      patch({
                        preserveNodeTransforms: character.preserveNodeTransforms.map((t, ti) =>
                          ti === i ? { nodeLabel: e.target.value } : t,
                        ),
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={() =>
                      patch({
                        preserveNodeTransforms: character.preserveNodeTransforms.filter(
                          (_, ti) => ti !== i,
                        ),
                      })
                    }
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  patch({
                    preserveNodeTransforms: [...character.preserveNodeTransforms, { nodeLabel: '' }],
                  })
                }
              >
                <Plus /> Add node
              </Button>
            </div>
          </div>
          <div>
            <Label className="mb-2 block">JCM morph modifications</Label>
            <JcmModsEditor
              value={character.jcmMorphMods}
              onCommit={(jcmMorphMods) => patch({ jcmMorphMods })}
            />
          </div>
          </div>
        </div>
      </details>

      <section className="mb-8">
        <h2 className="mb-3 text-xl font-semibold">ROM</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          The eight pose asset categories in their canonical order. Pre-defined sections load the
          DTH ROMs; custom sections define their own groups and poses. Frame numbers follow
          section, group and pose order — the generated Daz script and PoseAsset CSV share them
          automatically.
        </p>
        <RomSections
          sections={character.sections}
          genesis={character.genesis}
          gender={character.gender}
          skinning={characterSkinning(character)}
          catalog={catalog}
          onChange={(sections) => patch({ sections })}
        />
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="mb-1 text-xl font-semibold">Generate</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Files are written into this character's folder
          {settings.dazScriptsFolder ? (
            <>
              {' '}and the Daz files also to{' '}
              <code className="rounded bg-muted px-1.5 py-0.5">{settings.dazScriptsFolder}</code>
            </>
          ) : null}
          {' · '}preset catalog from{' '}
          <code className="rounded bg-muted px-1.5 py-0.5">
            {catalog.folder || 'not configured'}
          </code>
          {' — '}
          <Link to="/settings" className="underline hover:text-foreground">
            change in Settings
          </Link>
        </p>

        {imageDialogOpen && (
        <ImageDialog
          image={character.image}
          name={character.name}
          characterId={character.id}
          onApply={async (image) => {
            // Persist the avatar immediately — it's a deliberate change and
            // should survive a reload without needing the Save button.
            const updated = { ...character, image }
            setCharacter(updated)
            const saved = await saveCharacter({ data: { projectId, character: updated } })
            setCharacter(saved)
            await router.invalidate()
            toast.success('Image updated')
          }}
          onClose={() => setImageDialogOpen(false)}
        />
      )}

      {generated && (
          <>
            <p className="mb-1 text-sm text-muted-foreground">
              Written to <code className="rounded bg-muted px-1.5 py-0.5">{generated.outDir}</code>
            </p>
            {generated.dazScriptsFolder && (
              <p className="mb-1 text-sm text-muted-foreground">
                Daz files also written to{' '}
                <code className="rounded bg-muted px-1.5 py-0.5">{generated.dazScriptsFolder}</code>
              </p>
            )}
            {generated.dazScriptsError && (
              <p className="mb-1 text-sm text-destructive">
                Could not write to the DazToHue-Scripts folder: {generated.dazScriptsError}
              </p>
            )}
            <ul className="mt-4 space-y-2">
              {generated.files.map((file) => (
                <li key={file.fileName} className="flex items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => download(file)}>
                    <Download /> {file.fileName}
                  </Button>
                  <span className="text-xs text-muted-foreground uppercase">{file.target}</span>
                  {file.experimental && (
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-400">
                      experimental — format pending confirmation
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  )
}
