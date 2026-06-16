import { useRef, useState } from 'react'
import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FolderInput,
  Link2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'

import { Avatar } from '#/components/avatar.tsx'
import { ConfigError } from '#/components/config-error.tsx'
import { EditableTitle } from '#/components/editable-title.tsx'
import { PathCode } from '#/components/path-code.tsx'
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
  copyDazScene,
  fetchCharacter,
  fetchPoseAssets,
  fetchSettings,
  fileExists,
  generateCharacterFiles,
  getCharacterPath,
  moveCharacter,
  openScene,
  relinkScene,
  saveCharacter,
  uploadCharacterImage,
} from '#/lib/rom/api.ts'
import { pickDufPath } from '#/lib/desktop.ts'
import { displayPath, pathSeparator } from '#/lib/path.ts'
import { characterSkinning, countPoses, jcmMorphModSchema } from '@dth/rom'

import type { CharacterLocation } from '#/lib/rom/api.ts'
import type { GeneratedFile } from '@dth/rom'
import type { Character, GenesisVersion, TargetSkeleton } from '@dth/rom'

export const Route = createFileRoute('/projects/$projectId/characters/$characterId')({
  loader: async ({ params }) => {
    const { projectId, characterId: id } = params
    const character = await fetchCharacter({ data: { projectId, id } })
    if (!character) throw notFound()
    const [settings, catalog, location, sceneExists] = await Promise.all([
      fetchSettings(),
      fetchPoseAssets(),
      getCharacterPath({ data: { projectId, id } }),
      character.scenePath
        ? fileExists({ data: { path: character.scenePath } })
        : Promise.resolve(false),
    ])
    return { character, settings, catalog, location, sceneExists }
  },
  component: CharacterPage,
})

interface GenerateResult {
  outDir: string
  files: Array<GeneratedFile>
  scriptsDir: string | null
  scriptsError: string | null
}

// Full display names per generation, used for the genesis-specific fieldset
// legend. When G8 / G8.1 land, branch on the genesis to swap the fieldset body.
const GENESIS_LABELS: Record<GenesisVersion, string> = {
  G3: 'Genesis 3',
  G8: 'Genesis 8',
  'G8.1': 'Genesis 8.1',
  G9: 'Genesis 9',
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
  onMoved,
}: {
  projectId: string
  id: string
  location: CharacterLocation | null
  onMoved: (character: Character) => void
}) {
  const router = useRouter()
  const [relPath, setRelPath] = useState(() => {
    if (!location) return ''
    const fn = location.definitionAbs.split(/[\\/]/).pop() ?? ''
    return displayPath(location.relFolder ? `${location.relFolder}/${fn}` : fn)
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!location) return null
  const fileName = location.definitionAbs.split(/[\\/]/).pop() ?? ''
  const currentPath = displayPath(location.relFolder ? `${location.relFolder}/${fileName}` : fileName)
  const moved = relPath.trim() !== currentPath

  async function onMove() {
    if (busy || !moved || !relPath.trim()) return
    setBusy(true)
    setError('')
    try {
      const { character } = await moveCharacter({ data: { projectId, id, relPath: relPath.trim() } })
      await router.invalidate()
      onMoved(character)
      toast.success(`Moved to ${relPath.trim()}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Label className="mb-1 block">Filepath</Label>
      <div className="flex items-center gap-2">
        <span className="flex h-9 shrink-0 items-center rounded-md border bg-muted px-2.5 font-mono text-xs text-muted-foreground">
          {`${displayPath(location.libraryFolder)}${pathSeparator()}`}
        </span>
        <Input
          value={relPath}
          placeholder={displayPath('ElectraTest/ElectraTest.json')}
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

/**
 * The linked Daz scene: an "Open in Daz" button when the scene file is present,
 * or a "Link Daz scene" picker when it's missing / never linked. Picking a scene
 * outside the project pauses on a modal offering to copy it into the character's
 * folder (mirrors the create flow). Linking persists immediately, preserving any
 * unsaved editor edits.
 */
function DazSceneField({
  projectId,
  character,
  location,
  sceneExists,
  onLinked,
}: {
  projectId: string
  character: Character
  location: CharacterLocation
  sceneExists: boolean
  onLinked: (character: Character) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A picked scene outside the project pauses here awaiting the copy decision.
  const [pending, setPending] = useState('')
  const [subfolder, setSubfolder] = useState('daz3d')

  const linked = Boolean(character.scenePath)
  const ready = linked && sceneExists

  function insideProject(p: string): boolean {
    const norm = (s: string) => s.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
    return norm(p).startsWith(norm(location.libraryFolder) + '/')
  }

  async function onOpen() {
    setError('')
    try {
      await openScene({ data: { scenePath: character.scenePath } })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      toast.error(`Couldn't open in Daz: ${msg}`)
    }
  }

  async function onPick() {
    const picked = await pickDufPath('Select the Daz character scene (.duf)')
    if (!picked) return
    if (!insideProject(picked)) {
      setSubfolder('daz3d')
      setPending(picked)
      return
    }
    await applyLink(picked, false)
  }

  async function applyLink(scene: string, copyInto: boolean) {
    setBusy(true)
    setError('')
    try {
      const finalScene = copyInto
        ? await copyDazScene({
            data: {
              projectId,
              characterId: character.id,
              scenePath: scene,
              subfolder: subfolder.trim(),
            },
          })
        : scene
      const saved = await relinkScene({ data: { projectId, character, scenePath: finalScene } })
      onLinked(saved)
      setPending('')
      void router.invalidate()
      toast.success('Linked Daz scene')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Two-tone path chip like the header's definition path: the part that matches
  // the project folder is dimmed, the rest emphasized.
  const sceneAbs = displayPath(character.scenePath)
  const projectRoot = displayPath(location.libraryFolder)
  const sceneRootLen = sceneAbs.toLowerCase().startsWith(projectRoot.toLowerCase())
    ? projectRoot.length
    : 0
  const scenePathChip = (
    <PathCode path={sceneAbs} className="text-xs">
      {sceneRootLen > 0 && (
        <span className="text-muted-foreground/60">{sceneAbs.slice(0, sceneRootLen)}</span>
      )}
      <span className="text-foreground/80">{sceneAbs.slice(sceneRootLen)}</span>
    </PathCode>
  )

  return (
    <div>
      <Label className="mb-1 block">Daz scene</Label>
      <div className="flex flex-wrap items-center gap-3">
        {ready ? (
          <Button size="sm" className="shrink-0" onClick={() => void onOpen()}>
            <ExternalLink /> Open in Daz
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => void onPick()}
          >
            <Link2 /> {busy ? 'Linking…' : 'Link Daz scene'}
          </Button>
        )}
        {ready ? (
          scenePathChip
        ) : linked ? (
          <>
            <span className="text-xs text-muted-foreground">Missing —</span>
            {scenePathChip}
          </>
        ) : (
          <span className="text-xs text-muted-foreground">No scene linked.</span>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setPending('')}
        >
          <div
            className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Copy the Daz scene into the project?</h2>
            <p className="text-sm text-muted-foreground">
              The selected scene lives outside this project. Copy it (and its{' '}
              <code className="rounded bg-muted px-1 py-0.5">.png</code> /{' '}
              <code className="rounded bg-muted px-1 py-0.5">.tip.png</code> thumbnails) into the
              character's folder?
            </p>
            <div>
              <Label className="mb-1 block">Subfolder</Label>
              <Input
                value={subfolder}
                placeholder="(character folder root)"
                onChange={(e) => setSubfolder(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void applyLink(pending, false)}>
                Link in place
              </Button>
              <Button disabled={busy} onClick={() => void applyLink(pending, true)}>
                {busy ? 'Copying…' : 'Copy & link'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CharacterPage() {
  const { projectId } = Route.useParams()
  const { character: initial, settings, catalog, location, sceneExists } = Route.useLoaderData()
  const router = useRouter()
  // The page owns a draft copy; "Save" persists it and revalidates the loader.
  const [character, setCharacter] = useState<Character>(initial)
  // The last-persisted character. `dirty` compares against this — NOT the loader
  // data — so saving can settle the buttons in a single paint instead of waiting
  // on router.invalidate() to complete in a second, separate render.
  const [baseline, setBaseline] = useState<Character>(initial)
  const [saving, setSaving] = useState(false)
  const [generated, setGenerated] = useState<GenerateResult | null>(null)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const swallowNavRef = useRef(false)

  const dirty = JSON.stringify(character) !== JSON.stringify(baseline)

  // Absolute path to the character's definition JSON, shown under the header with
  // the project library root dimmed as a label prefix and the rest emphasized.
  const libRoot = displayPath(location?.libraryFolder ?? '')
  const defAbs = displayPath(location?.definitionAbs ?? '')
  const defSuffix = defAbs.startsWith(libRoot) ? defAbs.slice(libRoot.length) : defAbs

  function patch(p: Partial<Character>) {
    setCharacter((c) => ({ ...c, ...p }))
  }

  // Inline rename from the title — persists immediately (like the avatar) so the
  // new name + folder rename stick without needing the Save button.
  async function onRenameCharacter(next: string) {
    const previousName = character.name
    const updated = { ...character, name: next }
    setCharacter(updated)
    const saved = await saveCharacter({ data: { projectId, character: updated } })
    setCharacter(saved)
    setBaseline(saved)
    // Renaming moves the character folder + renames the generated script, so
    // regenerate at the new name and drop the old-named script in the shared folder.
    const result = await generateCharacterFiles({ data: { projectId, id: saved.id, previousName } })
    setGenerated(result)
    void router.invalidate()
    toast.success(`Renamed to “${next}”`)
    if (result.scriptsError) {
      toast.warning(`Couldn't install the character script: ${result.scriptsError}`)
    }
  }

  // Saving also (re)generates all DTH files in the same step.
  async function onSave() {
    setSaving(true)
    try {
      const saved = await saveCharacter({ data: { projectId, character } })
      const result = await generateCharacterFiles({ data: { projectId, id: saved.id } })
      // Settle everything in one batched render: reconcile the draft + baseline
      // (so it's no longer "dirty") and drop the saving flag together.
      setCharacter(saved)
      setBaseline(saved)
      setGenerated(result)
      setSaving(false)
      // Refresh the loader for re-entry/navigation, but don't await it — the
      // buttons no longer depend on it, so it stays off the visible path.
      void router.invalidate()
      toast.success(`Saved “${saved.name}” and generated ${result.files.length} files`)
      if (result.scriptsError) {
        toast.warning(`Couldn't install the character script: ${result.scriptsError}`)
      }
    } catch (e) {
      setSaving(false)
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  function onDiscard() {
    setCharacter(baseline)
  }

  // Linking a Daz scene persists immediately (see relinkScene), so settle the
  // draft + baseline on the saved result — like the inline rename / avatar.
  function onSceneLinked(saved: Character) {
    setCharacter(saved)
    setBaseline(saved)
  }

  // A folder move can repoint the linked scene (it travels with the folder when
  // it lives inside it). Sync just the scene path into the draft + baseline so
  // the Daz scene field stays correct without discarding any unsaved edits.
  function onCharacterMoved(moved: Character) {
    setCharacter((c) => ({ ...c, scenePath: moved.scenePath }))
    setBaseline((b) => ({ ...b, scenePath: moved.scenePath }))
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

      <header className="sticky top-0 z-10 mb-8 flex items-end gap-5 bg-background">
        <button
          type="button"
          className="group relative shrink-0"
          title="Edit the character image"
          onClick={() => setImageDialogOpen(true)}
        >
          <Avatar
            image={character.image}
            name={character.name}
            className="aspect-[3/4] w-[170px] rounded-lg bg-neutral-300"
            fallbackClassName="text-6xl"
          />
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Pencil className="size-8 text-white" />
          </span>
        </button>
        <div className="pb-6">
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
          {location && (
            <p className="mt-1.5 text-xs">
              <PathCode path={defAbs}>
                <span className="text-muted-foreground/60">{libRoot}</span>
                <span className="text-foreground/80">{defSuffix}</span>
              </PathCode>
            </p>
          )}
        </div>
      </header>

      <section className="mb-8 rounded-lg border bg-card p-5 pt-7">
        <div className="flex flex-wrap gap-x-12 gap-y-5">
          <div className="flex flex-col gap-5">
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

          {/* The legend is positioned absolutely (a notch on the border) so it
              doesn't consume a row of flow — that keeps the FACS / Flexion fields
              on the same baseline as the Genesis row on the left. -mt-2 + pt-2
              lift the box so its fields start at the same y as the left column. */}
          <fieldset className="relative -mt-2 self-start rounded-md border px-4 pt-2 pb-4">
            <legend className="absolute -top-2 left-3 bg-card px-1 text-xs font-medium text-muted-foreground">
              {GENESIS_LABELS[character.genesis]} Specific
            </legend>
            {/* Genesis-9-specific tuning. When G8 / G8.1 support lands, branch on
                character.genesis here and swap in that version's settings. */}
            <div className="flex flex-wrap gap-4">
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
          </fieldset>
        </div>
        {location && (
          <div className="mt-6 space-y-4 border-t pt-5">
            <StorageLocation
              projectId={projectId}
              id={character.id}
              location={location}
              onMoved={onCharacterMoved}
            />
            <DazSceneField
              projectId={projectId}
              character={character}
              location={location}
              sceneExists={sceneExists}
              onLinked={onSceneLinked}
            />
          </div>
        )}
      </section>

      <details className="mb-8 rounded-lg border bg-card">
        <summary className="cursor-pointer px-5 py-3 font-medium select-none">
          Advanced options
        </summary>
        <div className="space-y-6 border-t p-5">
          <div className="flex items-center gap-3">
            <Switch
              checked={character.resetGPBeforeApplying}
              onCheckedChange={(resetGPBeforeApplying) => patch({ resetGPBeforeApplying })}
            />
            <span className="text-sm">Reset GP before applying extra frames</span>
          </div>
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
          The PoseAsset CSV is written into this character's folder; the
          self-contained Daz script{' '}
          {settings.dazLibraryFolder ? (
            <>
              (plus the DTH runtime it imports) installs to{' '}
              <PathCode
                path={displayPath(`${settings.dazLibraryFolder}/Scripts/DTH-Character-Studio`)}
              />
            </>
          ) : (
            'installs once you set "My DAZ 3D Library" in Settings'
          )}
          {' · '}preset catalog from{' '}
          {displayPath(catalog.folder) ? (
            <PathCode path={displayPath(catalog.folder)} />
          ) : (
            <code className="rounded bg-muted px-1.5 py-0.5">not configured</code>
          )}
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
            setBaseline(saved)
            void router.invalidate()
            toast.success('Image updated')
          }}
          onClose={() => setImageDialogOpen(false)}
        />
      )}

      {generated && (
          <>
            <p className="mb-1 text-sm text-muted-foreground">
              PoseAsset written to <PathCode path={displayPath(generated.outDir)} />
            </p>
            {generated.scriptsDir && (
              <p className="mb-1 text-sm text-muted-foreground">
                Character script installed to{' '}
                <PathCode path={displayPath(generated.scriptsDir)} />
              </p>
            )}
            {generated.scriptsError && (
              <ConfigError message={generated.scriptsError} className="mb-1" />
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
