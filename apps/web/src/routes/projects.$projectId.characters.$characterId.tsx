import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { z } from 'zod'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderInput,
  FolderOpen,
  Link2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'

import { Avatar } from '#/components/avatar.tsx'
import { EditableTitle } from '#/components/editable-title.tsx'
import { Field } from '#/components/field.tsx'
import { PathCode, pathChipClass } from '#/components/path-code.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { Tag } from '#/components/tag.tsx'
import { RemoveAssetDialog } from '#/components/remove-asset-dialog.tsx'
import { SceneCopyDialog } from '#/components/scene-copy-dialog.tsx'
import dazLogo from '#/assets/daz-logo.png'
import houdiniLogo from '#/assets/houdini-logo.svg'
import { toast } from 'sonner'
import { RomSections } from '#/components/rom-sections.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import { InfoPopup } from '#/components/ui/info-popup.tsx'
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
  characterKeepFolders,
  copyDazScene,
  deleteCharacter,
  deleteFiles,
  fetchCharacter,
  fetchPoseAssets,
  fetchProductScan,
  fetchProject,
  fetchSettings,
  fileExists,
  generateCharacterFiles,
  getCharacterPath,
  moveCharacter,
  setActiveProjectDir,
  openScene,
  relinkScene,
  resolvePresetFrames,
  saveCharacter,
  setAvatarFromScene,
  uploadCharacterImage,
  uploadCharacterImageFromPath,
} from '#/lib/rom/api.ts'
import { BulkDeleteDialog } from '#/components/bulk-delete-dialog.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { pickDufPath, pickFolder, pickHipPath } from '#/lib/desktop.ts'
import { open as openExternal } from '@tauri-apps/plugin-shell'

/**
 * Daz readme page for a DIM product SKU ("86958-1" → store id `86958`). It resolves
 * by SKU, names the product, and links to its store page — the only SKU-keyed Daz
 * URL that reliably maps to a product. Returns '' when the SKU isn't a numeric DIM
 * store id (LOCAL_USER / third-party products carry none → no link).
 */
function dazProductUrl(sku: string): string {
  const id = (sku || '').split('-')[0]?.trim() ?? ''
  return /^\d+$/.test(id) ? `https://docs.daz3d.com/doku.php/public/read_me/index/${id}/start` : ''
}
import { studioCharScriptsDir } from '#/lib/rom/storage.ts'
import { displayPath, pathSeparator } from '#/lib/path.ts'
import { characterSkinning, characterSlug, countPoses, jcmMorphModSchema } from '@dth/rom'

import type { CharacterLocation } from '#/lib/rom/api.ts'
import type { GeneratedFile, PresetFrames } from '@dth/rom'
import type { Character, GenesisVersion } from '@dth/rom'

export const Route = createFileRoute('/projects/$projectId/characters/$characterId')({
  loader: async ({ params }) => {
    const { projectId, characterId: id } = params
    // The route param IS the project's folder — pin it so avatars resolve.
    setActiveProjectDir(projectId)
    const character = await fetchCharacter({ data: { projectId, id } })
    if (!character) throw notFound()
    // The Daz scenes folder = the directory holding the primary scene. Tracking
    // its existence lets the editor offer a folder re-link if it was renamed/moved
    // outside the app (distinct from a single scene file going missing).
    const sceneFolder = character.scenePath
      ? character.scenePath.replace(/[\\/][^\\/]*$/, '')
      : ''
    const [project, settings, catalog, location, sceneExists, sceneFolderExists, productScan] =
      await Promise.all([
        fetchProject({ data: { projectId } }),
        fetchSettings(),
        fetchPoseAssets(),
        getCharacterPath({ data: { projectId, id } }),
        character.scenePath
          ? fileExists({ data: { path: character.scenePath } })
          : Promise.resolve(false),
        sceneFolder ? fileExists({ data: { path: sceneFolder } }) : Promise.resolve(false),
        // Best-effort: a scan CSV exists only after the user runs the generated
        // Scan_Products script in Daz. Harmless when the feature is off (the UI
        // section that consumes it is gated on project.dazProductsEnabled).
        fetchProductScan({ data: { projectId, id } }),
      ])
    // Preset ROM block lengths, measured live from the actual .duf assets. Null
    // (best-effort) when an included asset can't be read — the editor then shows
    // a notice and generation hard-errors; opening the character never fails.
    const presetFrames = await resolvePresetFrames(character, catalog).catch(() => null)
    return {
      character,
      project,
      settings,
      catalog,
      location,
      sceneExists,
      sceneFolderExists,
      presetFrames,
      productScan,
    }
  },
  component: CharacterPageRoute,
})

/**
 * Keys the editor by the character id so it remounts on an editor→editor
 * navigation (e.g. Clone jumping to the new copy). Without this, only the URL
 * param changes — the same `CharacterPage` instance stays mounted and its draft
 * state, seeded from the loader at mount, keeps showing the previous character.
 */
function CharacterPageRoute() {
  const { characterId } = Route.useParams()
  return <CharacterPage key={characterId} />
}

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
  scenes,
  onApply,
  onClose,
}: {
  image: string
  name: string
  characterId: string
  /** Linked Daz scene paths — each offers its `.tip.png` as a pickable avatar. */
  scenes: Array<string>
  onApply: (image: string) => void | Promise<void>
  onClose: () => void
}) {
  const [url, setUrl] = useState(image)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  // Native OS drag-drop gives a path — read + upload it server-side.
  async function uploadPath(path: string) {
    setBusy(true)
    setError('')
    try {
      const served = await uploadCharacterImageFromPath({ data: { characterId, path } })
      setUrl(served)
      onApply(served)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

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

  // Switch the avatar to a linked scene's tip thumbnail (copied into the app's
  // images folder). Mirrors the upload handlers — updates the preview + persists.
  async function applyScene(scenePath: string) {
    setBusy(true)
    setError('')
    try {
      const served = await setAvatarFromScene({ data: { characterId, scenePath } })
      setUrl(served)
      await onApply(served)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Portaled to <body> so the editor body can use CSS containment without this
  // fixed overlay resolving against the contained box instead of the viewport.
  return createPortal(
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

        <FileDropZone
          accept={['png', 'jpg', 'jpeg', 'webp', 'gif']}
          onDrop={(paths) => paths[0] && void uploadPath(paths[0])}
          label="Drop image to set the avatar"
          className="rounded-lg"
        >
          <div
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-input px-4 py-6 text-center text-sm text-muted-foreground transition-colors hover:border-primary"
            onClick={() => fileInput.current?.click()}
          >
            {busy ? 'Uploading…' : 'Drop an image here, or click to pick one'}
          </div>
        </FileDropZone>

        {/* Offer the linked scenes' thumbnails whenever there's at least one — the
            current avatar may have come from a scene since unlinked, so even a
            single remaining scene needs to be selectable to switch back to it. */}
        {scenes.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm text-muted-foreground">
              {scenes.length === 1 ? "Or use the linked Daz scene's image:" : "Or use a linked Daz scene's image:"}
            </p>
            <div className="flex flex-wrap gap-2">
              {scenes.map((scene) => (
                <button
                  key={scene}
                  type="button"
                  disabled={busy}
                  onClick={() => void applyScene(scene)}
                  title={scene.split(/[\\/]/).pop()}
                  className="rounded-md ring-2 ring-transparent transition hover:ring-primary focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50"
                >
                  <Portrait
                    scenePath={scene}
                    name={name}
                    className="aspect-[3/4] w-16 rounded-md"
                    fallbackClassName="text-lg"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

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
    </div>,
    document.body,
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
  const [subdir, setSubdir] = useState(() => displayPath(location?.relFolder ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!location) return null

  // Only the subdirectory is editable — the definition keeps its current filename,
  // which follows the character name (renaming the character renames it). The
  // subdirectory may nest (a/b/c) but is required (each character owns a folder).
  const clean = (s: string) => s.split(/[\\/]+/).filter(Boolean).join('/')
  const subdirForward = clean(subdir)
  const currentSubdir = clean(location.relFolder)
  const fileName = location.definitionAbs.split(/[\\/]/).pop() ?? ''

  const subdirError = !subdirForward ? 'A subdirectory is required.' : ''
  const changed = subdirForward !== currentSubdir
  const canMove = Boolean(subdirForward) && changed && !busy

  async function onMove() {
    if (!canMove) return
    // Keep the current filename (it follows the character name); just move the
    // folder. The backend normalizes separators again.
    const relPath = `${subdirForward}/${fileName}`
    setBusy(true)
    setError('')
    try {
      const { character } = await moveCharacter({ data: { projectId, id, relPath } })
      await router.invalidate()
      onMoved(character)
      toast.success(`Moved to ${displayPath(relPath)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onEnter = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void onMove()
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start gap-2">
        <Field label="Character directory" error={subdirError} className="min-w-[9rem] flex-1">
          <Input
            value={subdir}
            placeholder={displayPath('Aria_G9')}
            aria-invalid={subdirError ? true : undefined}
            onChange={(e) => setSubdir(e.target.value)}
            onKeyDown={onEnter}
          />
        </Field>
        <Field className="shrink-0">
          <Button variant="outline" onClick={onMove} disabled={!canMove}>
            <FolderInput /> Move
          </Button>
        </Field>
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}

/**
 * A linked Daz scene as a clickable card — its `.tip.png` portrait, the
 * filename, and the Daz badge; clicking the whole card opens the scene in Daz.
 */
function SceneCard({
  scenePath,
  name,
  charFolderAbs,
  onOpen,
  onRemove,
  primary,
}: {
  scenePath: string
  name: string
  /** The character's folder; the scene's path relative to it (incl. the daz
   *  scenes folder) is shown as a chip, e.g. "%CHAR%\daz3d\Outfit_Summertide\". */
  charFolderAbs: string
  onOpen: () => void
  /** When set, a hover ✕ unlinks the scene from the character (file is kept). */
  onRemove?: () => void
  /** The character's original creation scene — gets a "primary" badge and is not
   *  unlinkable (the caller omits onRemove). */
  primary?: boolean
}) {
  const fileName = scenePath.split(/[\\/]/).pop() ?? scenePath
  // The heading shows the scene name without its extension (e.g. ".duf").
  const displayName = fileName.replace(/\.[^./\\]+$/, '')
  // The scene's folder relative to the character folder — e.g. "daz3d" for a
  // scene directly in the scenes folder, or "daz3d/Outfit_Summertide" when
  // nested. Empty for a scene linked outside the character folder.
  const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const sceneDir = norm(scenePath).replace(/\/[^/]*$/, '')
  const base = norm(charFolderAbs)
  const relSub =
    base && sceneDir.toLowerCase().startsWith(base.toLowerCase() + '/')
      ? sceneDir.slice(base.length + 1)
      : ''
  return (
    <div className="group/card relative w-80">
      <button
        type="button"
        onClick={onOpen}
        title="Open in Daz"
        className="daz-card group relative flex h-full w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors"
      >
        <Portrait
          scenePath={scenePath}
          name={name}
          className="aspect-[3/4] w-14 shrink-0 rounded-md"
          fallbackClassName="text-xl"
        />
        {/* Daz brand mark, floating bottom-left as a badge on the portrait. */}
        <img
          src={dazLogo}
          alt=""
          aria-hidden
          className="pointer-events-none absolute bottom-1 left-1 size-8 object-contain drop-shadow-md"
        />
        <div className="min-w-0 text-xs">
          <div className="truncate text-sm font-medium">{displayName}</div>
          {relSub && (
            <code
              className={`${pathChipClass('secondary')} mt-1 inline-block max-w-full truncate align-middle`}
            >
              {`%CHAR%${pathSeparator()}${displayPath(relSub)}${pathSeparator()}`}
            </code>
          )}
          {primary && (
            <div className="mt-1">
              <Tag tone="green" title="The character's original scene — it can't be unlinked">
                primary
              </Tag>
            </div>
          )}
        </div>
        <ExternalLink className="absolute right-3 bottom-3 size-4 text-muted-foreground transition-colors group-hover:text-daz-green" />
      </button>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1.5 right-1.5 size-7 opacity-0 transition-opacity group-hover/card:opacity-100"
          title="Unlink from character"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      )}
    </div>
  )
}

/**
 * The character's Daz scenes: the primary `scenePath` plus any `extraScenes`
 * (outfit variants), each shown as a card that opens it in Daz. "Add scene"
 * picks another `.duf`; one outside the character folder pauses on a modal that
 * copies it into the scenes folder (the modal's subdir nests inside that). The
 * primary still uses the link/relink flow (it's also the avatar source).
 */
function DazSceneField({
  projectId,
  character,
  location,
  sceneExists,
  sceneFolderExists,
  defaultSubdir,
  onLinked,
}: {
  projectId: string
  character: Character
  location: CharacterLocation
  sceneExists: boolean
  sceneFolderExists: boolean
  defaultSubdir: string
  onLinked: (character: Character) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A picked scene outside the project pauses here awaiting the copy decision.
  const [pending, setPending] = useState('')
  const [subfolder, setSubfolder] = useState(() => defaultSubdir)
  // A picked *additional* scene awaiting its copy decision — separate from the
  // primary link flow. Its subfolder nests inside the existing scenes folder.
  const [pendingAdd, setPendingAdd] = useState('')
  const [addSubfolder, setAddSubfolder] = useState('')
  // When on, the source scene is deleted after copying (a move). Off by default;
  // mutually exclusive with "Link in place" (which keeps the original in place).
  const [deleteOriginal, setDeleteOriginal] = useState(false)
  // A scene pending the unlink confirm + whether to also delete it from disk.
  const [pendingRemove, setPendingRemove] = useState('')
  const [removeDeleteFile, setRemoveDeleteFile] = useState(false)

  // Esc closes the primary link modal (the Add modal is a SceneCopyDialog, which
  // wires its own Esc). This one isn't a Radix dialog, so it's by hand; ignored
  // while a copy is in flight.
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setPending('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, busy])

  const linked = Boolean(character.scenePath)
  const ready = linked && sceneExists
  // The whole scenes folder is gone (renamed/moved outside the app) — offer to
  // re-link it, which re-points every scene path to the folder's new location.
  const folderMissing = linked && !sceneFolderExists

  const norm = (s: string) => s.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  function insideProject(p: string): boolean {
    return norm(p).toLowerCase().startsWith(norm(location.libraryFolder).toLowerCase() + '/')
  }
  // The character's own folder, and the primary scene's folder relative to it
  // (e.g. "daz3d") — added scenes are copied there; the modal subdir nests inside.
  const charFolder = norm(location.definitionAbs).replace(/\/[^/]*$/, '')
  function insideCharFolder(p: string): boolean {
    return norm(p).toLowerCase().startsWith(charFolder.toLowerCase() + '/')
  }
  // Every scene already attached to this character (primary + extras). A scene is
  // linked at most once, so a pick/drop that repeats one is rejected up front.
  const linkedScenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  function isAlreadyLinked(p: string): boolean {
    const target = norm(p).toLowerCase()
    return linkedScenes.some((s) => norm(s).toLowerCase() === target)
  }
  const primaryDir = character.scenePath ? norm(character.scenePath).replace(/\/[^/]*$/, '') : ''
  const baseDazRel =
    primaryDir && primaryDir.toLowerCase().startsWith(charFolder.toLowerCase() + '/')
      ? primaryDir.slice(charFolder.length + 1)
      : defaultSubdir
  const cleanSub = (s: string) => s.split(/[\\/]+/).filter(Boolean).join('/')

  async function onOpen(scenePath: string) {
    setError('')
    try {
      await openScene({ data: { scenePath } })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      toast.error(`Couldn't open in Daz: ${msg}`)
    }
  }

  // The scenes folder was renamed/moved on disk. Pick its new location (opening
  // in the character folder) and re-point every scene path under the old folder
  // to the new one, preserving each scene's relative subpath.
  async function onRelinkFolder() {
    const picked = await pickFolder('Select the Daz scenes folder', charFolder)
    if (!picked) return
    setBusy(true)
    setError('')
    try {
      const oldBase = norm(character.scenePath).replace(/\/[^/]*$/, '')
      const newBase = norm(picked)
      const repoint = (p: string) => {
        const rel = norm(p)
        return rel.toLowerCase().startsWith(oldBase.toLowerCase() + '/')
          ? `${newBase}/${rel.slice(oldBase.length + 1)}`
          : p // a scene linked outside the folder is left untouched
      }
      const next: Character = {
        ...character,
        scenePath: repoint(character.scenePath),
        extraScenes: character.extraScenes.map(repoint),
      }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      onLinked(saved)
      void router.invalidate()
      toast.success('Relinked the Daz scenes folder')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onAddPick() {
    const picked = await pickDufPath('Select another Daz scene (.duf)')
    if (!picked) return
    if (!insideCharFolder(picked)) {
      setAddSubfolder('')
      setDeleteOriginal(false)
      setPendingAdd(picked)
      return
    }
    await applyAdd(picked, false)
  }

  async function applyAdd(scene: string, copyInto: boolean) {
    const sceneName = scene.split(/[\\/]/).pop() ?? scene
    const subfolder = [baseDazRel, cleanSub(addSubfolder)].filter(Boolean).join('/')
    // Reject a scene that's already attached, before any copy runs. An in-place add
    // compares the picked path itself; a copy compares its destination inside the
    // character folder — which catches re-copying the same external scene (its source
    // path differs from the in-folder copy, but the destination collides, which would
    // otherwise overwrite the existing copy and add a duplicate card). Checking up
    // front also means a `deleteOriginal` move never deletes the source then bails.
    const dest = copyInto ? [charFolder, subfolder, sceneName].filter(Boolean).join('/') : scene
    if (isAlreadyLinked(dest)) {
      toast.error(`“${sceneName}” is already linked to this character.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const finalScene = copyInto
        ? await copyDazScene({
            data: {
              projectId,
              characterId: character.id,
              scenePath: scene,
              subfolder,
              deleteOriginal,
            },
          })
        : scene
      const next: Character = { ...character, extraScenes: [...character.extraScenes, finalScene] }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      onLinked(saved)
      setPendingAdd('')
      void router.invalidate()
      toast.success('Added Daz scene')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onPick() {
    const picked = await pickDufPath('Select the Daz character scene (.duf)')
    if (!picked) return
    if (!insideProject(picked)) {
      setSubfolder(defaultSubdir)
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

  // OS drag-and-drop of a .duf: with no scene yet, link it as the primary; once
  // linked, add it as an extra. Reuses the same copy-vs-link prompts as Browse.
  function onDropScene(paths: Array<string>) {
    const scene = paths[0]
    if (!scene) return
    if (!linked) {
      if (!insideProject(scene)) {
        setSubfolder(defaultSubdir)
        setPending(scene)
        return
      }
      void applyLink(scene, false)
    } else {
      if (!insideCharFolder(scene)) {
        setAddSubfolder('')
        setDeleteOriginal(false)
        setPendingAdd(scene)
        return
      }
      void applyAdd(scene, false)
    }
  }

  // Open the unlink confirm. Default "delete file" on for a scene inside the
  // character folder (a copy), off for one linked in place outside it.
  function askRemove(scene: string) {
    setError('')
    setRemoveDeleteFile(insideCharFolder(scene))
    setPendingRemove(scene)
  }

  async function confirmRemove() {
    const scene = pendingRemove
    setBusy(true)
    setError('')
    try {
      if (removeDeleteFile) {
        const noDuf = scene.replace(/\.duf$/i, '')
        await deleteFiles({
          data: { paths: [scene, `${scene}.png`, `${scene}.tip.png`, `${noDuf}.tip.png`] },
        })
      }
      // Collapse the scene list (primary + extras), promoting the first remaining
      // scene to primary when the primary itself was removed.
      const all = [character.scenePath, ...character.extraScenes].filter(Boolean)
      const remaining = all.filter((s) => s !== scene)
      const next: Character = {
        ...character,
        scenePath: remaining[0] ?? '',
        extraScenes: remaining.slice(1),
      }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      onLinked(saved)
      setPendingRemove('')
      void router.invalidate()
      toast.success(removeDeleteFile ? 'Deleted Daz scene' : 'Unlinked Daz scene')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Two-tone path chip for the scenes' folder (the primary scene's directory) —
  // the project-root prefix dimmed, the rest emphasized.
  const sceneAbs = displayPath(character.scenePath)
  const projectRoot = displayPath(location.libraryFolder)
  const lastSep = Math.max(sceneAbs.lastIndexOf('\\'), sceneAbs.lastIndexOf('/'))
  const sceneDir = lastSep >= 0 ? sceneAbs.slice(0, lastSep) : ''
  const dirRootLen = sceneDir.toLowerCase().startsWith(projectRoot.toLowerCase())
    ? projectRoot.length
    : 0
  const sceneDirChip = (
    <PathCode path={sceneDir}>
      {dirRootLen > 0 && (
        <span className="text-muted-foreground/60">{sceneDir.slice(0, dirRootLen)}</span>
      )}
      <span className="text-foreground/80">{sceneDir.slice(dirRootLen)}</span>
    </PathCode>
  )

  return (
    <FileDropZone
      accept={['duf']}
      onDrop={onDropScene}
      label={linked ? 'Drop a Daz scene (.duf) to add' : 'Drop a Daz scene (.duf) to link'}
      className="rounded-lg"
    >
      <Label className="mb-1 block">Daz scenes</Label>
      {linked ? (
        folderMissing ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-destructive/50 p-3 text-sm text-muted-foreground">
            <span>
              The Daz scenes folder {sceneDirChip} is missing — renamed or moved outside the
              studio?
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void onRelinkFolder()}
            >
              <FolderInput /> {busy ? 'Relinking…' : 'Relink folder'}
            </Button>
          </div>
        ) : (
          <>
            {/* Copyable path to the scenes' folder, above the cards. */}
            <p className="mb-2 text-xs">{sceneDirChip}</p>
            <div className="flex flex-wrap items-stretch gap-3">
              {ready ? (
                <SceneCard
                  scenePath={character.scenePath}
                  name={character.name}
                  charFolderAbs={charFolder}
                  onOpen={() => void onOpen(character.scenePath)}
                  primary
                />
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-destructive/50 p-3 py-8 text-sm text-muted-foreground">
                  Primary scene missing.
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void onPick()}>
                    <Link2 /> Relink
                  </Button>
                </div>
              )}
              {character.extraScenes.map((scene, i) => (
                <SceneCard
                  key={`${scene}-${i}`}
                  scenePath={scene}
                  name={character.name}
                  charFolderAbs={charFolder}
                  onOpen={() => void onOpen(scene)}
                  onRemove={() => askRemove(scene)}
                />
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={busy}
              onClick={() => void onAddPick()}
            >
              <Plus /> {busy ? 'Adding…' : 'Add scene'}
            </Button>
          </>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => void onPick()}
          >
            <Link2 /> {busy ? 'Linking…' : 'Link Daz scene'}
          </Button>
          <span className="text-xs text-muted-foreground">No scene linked.</span>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {pending &&
        createPortal(
        // Portaled to <body> — see ImageDialog — so the contained editor body
        // doesn't become this fixed overlay's containing block.
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
              The selected scene lives outside this project. Copy it into the
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
        </div>,
        document.body,
      )}

      {pendingAdd && (
        <SceneCopyDialog
          title="Add Daz scene to the character?"
          description="The selected scene lives outside the character folder. Copy it into the character folder?"
          prefix={displayPath(`${baseDazRel}/`)}
          subfolder={addSubfolder}
          onSubfolderChange={setAddSubfolder}
          deleteOriginal={deleteOriginal}
          onDeleteOriginalChange={setDeleteOriginal}
          busy={busy}
          error={error}
          copyLabel="Copy & add"
          onCopy={() => void applyAdd(pendingAdd, true)}
          onLink={() => void applyAdd(pendingAdd, false)}
          onClose={() => setPendingAdd('')}
        />
      )}

      {pendingRemove && (
        <RemoveAssetDialog
          title="Remove Daz scene?"
          description="Unlink this Daz scene from the character."
          deleteFile={removeDeleteFile}
          onDeleteFileChange={setRemoveDeleteFile}
          // A scene linked in place (outside the character folder) is the user's
          // original — disable delete so it can only be unlinked, never removed.
          deleteFileDisabled={!insideCharFolder(pendingRemove)}
          busy={busy}
          error={error}
          onConfirm={() => void confirmRemove()}
          onClose={() => setPendingRemove('')}
        />
      )}
    </FileDropZone>
  )
}

/** A linked Houdini project: the Houdini logo (no preview image), the filename,
 *  and its folder — the whole card opens it in Houdini. Houdini projects are
 *  linked in place (never copied), so the folder is shown in full. */
function HoudiniCard({
  hipPath,
  charFolderAbs,
  avatarSrc,
  onOpen,
  onRemove,
}: {
  hipPath: string
  /** The character's folder; when the project sits inside it, the chip shows
   *  "%CHAR%" in place of that prefix. */
  charFolderAbs: string
  /** Gender-based placeholder avatar (a Houdini project has no thumbnail). */
  avatarSrc: string
  onOpen: () => void
  /** When set, a hover ✕ unlinks the project from the character. */
  onRemove?: () => void
}) {
  const fileName = hipPath.split(/[\\/]/).pop() ?? hipPath
  // The heading shows the project name without its extension (e.g. ".hiplc").
  const displayName = fileName.replace(/\.[^./\\]+$/, '')
  // The chip shows the project's folder; when it sits inside the character's own
  // folder, collapse that prefix to "%CHAR%" (like the Daz scene cards).
  const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const hipDir = norm(hipPath).replace(/\/[^/]*$/, '')
  const base = norm(charFolderAbs)
  const inChar =
    !!base &&
    (hipDir.toLowerCase() === base.toLowerCase() ||
      hipDir.toLowerCase().startsWith(base.toLowerCase() + '/'))
  const dir = inChar
    ? '%CHAR%' + hipDir.slice(base.length).split('/').join(pathSeparator())
    : displayPath(hipDir)
  return (
    <div className="group/card relative w-80">
      <button
        type="button"
        onClick={onOpen}
        title="Open in Houdini"
        className="houdini-card group relative flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors"
      >
        <Portrait
          src={avatarSrc}
          name={displayName}
          className="aspect-[3/4] w-14 shrink-0 rounded-md"
          fallbackClassName="text-xl"
        />
        {/* Houdini brand mark, floating bottom-left as a badge on the avatar. */}
        <img
          src={houdiniLogo}
          alt=""
          aria-hidden
          className="pointer-events-none absolute bottom-1 left-1 size-8 object-contain drop-shadow-md"
        />
        <div className="min-w-0 text-xs">
          <div className="truncate text-sm font-medium">{displayName}</div>
          {dir && (
            <code
              className={`${pathChipClass('secondary')} mt-1 inline-block max-w-full truncate align-middle`}
            >
              {dir}
            </code>
          )}
        </div>
        <ExternalLink className="absolute right-3 bottom-3 size-4 text-muted-foreground transition-colors group-hover:text-houdini-orange" />
      </button>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1.5 right-1.5 size-7 opacity-0 transition-opacity group-hover/card:opacity-100"
          title="Unlink from character"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      )}
    </div>
  )
}

/**
 * The character's Houdini projects — a flat list (no primary / avatar, unlike Daz
 * scenes). Houdini projects are linked in place and never copied: a Houdini DTH
 * project stores absolute import paths for its referenced files, so relocating it
 * would break those references. "Add project" picks a `.hip` and links it as-is.
 */
function HoudiniProjectsField({
  projectId,
  character,
  location,
  onChanged,
}: {
  projectId: string
  character: Character
  location: CharacterLocation
  onChanged: (character: Character) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A project pending the unlink confirm. Houdini projects are only ever linked
  // in place (absolute import paths forbid copying), so removing is unlink-only —
  // never a file delete, which would hit the user's real .hip.
  const [pendingRemove, setPendingRemove] = useState('')

  const projects = character.houdiniProjects
  const hasProjects = projects.length > 0
  // The character's own folder — projects linked inside it show a "%CHAR%" prefix.
  const charFolder = location.definitionAbs
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .replace(/\/[^/]*$/, '')
  // A Houdini project has no thumbnail — use a gender-based placeholder avatar.
  const placeholderSrc =
    character.gender === 'male' ? '/charPlaceholderMale.png' : '/charPlaceholderFemale.png'

  // Folder chip for the linked projects (the first project's directory), with the
  // project-root prefix dimmed and the rest emphasized — matching the Daz scenes chip.
  const projectRoot = displayPath(location.libraryFolder)
  const firstHipAbs = displayPath(projects[0] ?? '')
  const hipLastSep = Math.max(firstHipAbs.lastIndexOf('\\'), firstHipAbs.lastIndexOf('/'))
  const projectDir = hipLastSep >= 0 ? firstHipAbs.slice(0, hipLastSep) : ''
  const projectRootLen = projectDir.toLowerCase().startsWith(projectRoot.toLowerCase())
    ? projectRoot.length
    : 0
  const projectDirChip = (
    <PathCode path={projectDir}>
      {projectRootLen > 0 && (
        <span className="text-muted-foreground/60">{projectDir.slice(0, projectRootLen)}</span>
      )}
      <span className="text-foreground/80">{projectDir.slice(projectRootLen)}</span>
    </PathCode>
  )

  async function onOpen(hipPath: string) {
    setError('')
    try {
      await openScene({ data: { scenePath: hipPath } })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      toast.error(`Couldn't open in Houdini: ${msg}`)
    }
  }

  // Houdini projects are linked in place — store each `.hip` path as-is, skipping
  // any already linked. Shared by the Browse button and OS drag-and-drop.
  async function addProjects(paths: Array<string>) {
    const fresh = paths.filter((p) => !character.houdiniProjects.includes(p))
    if (fresh.length === 0) return
    setBusy(true)
    setError('')
    try {
      const next: Character = {
        ...character,
        houdiniProjects: [...character.houdiniProjects, ...fresh],
      }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      onChanged(saved)
      void router.invalidate()
      toast.success(
        fresh.length === 1 ? 'Linked Houdini project' : `Linked ${fresh.length} Houdini projects`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onAddPick() {
    const picked = await pickHipPath('Select a Houdini project (.hip)')
    if (picked) await addProjects([picked])
  }

  function askRemove(hip: string) {
    setError('')
    setPendingRemove(hip)
  }

  async function confirmRemove() {
    const hip = pendingRemove
    setBusy(true)
    setError('')
    try {
      const next: Character = {
        ...character,
        houdiniProjects: character.houdiniProjects.filter((p) => p !== hip),
      }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      onChanged(saved)
      setPendingRemove('')
      void router.invalidate()
      toast.success('Unlinked Houdini project')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FileDropZone
      accept={['hip', 'hipnc', 'hiplc']}
      onDrop={(paths) => void addProjects(paths)}
      label="Drop Houdini project(s) to link"
      className="rounded-lg"
    >
      <Label className={`${hasProjects ? 'mb-1' : 'mb-2'} flex w-fit items-center gap-1`}>
        Houdini projects
        <InfoPopup label="Houdini projects — more information">
          Linked in place (not copied) — a Houdini project keeps absolute import paths that a
          copy would break. Drag <code>.hip</code> files here or use the button.
        </InfoPopup>
      </Label>
      {hasProjects && <p className="mb-2 text-xs">{projectDirChip}</p>}
      {hasProjects && (
        <div className="flex flex-wrap items-start gap-3">
          {projects.map((hip, i) => (
            <HoudiniCard
              key={`${hip}-${i}`}
              hipPath={hip}
              charFolderAbs={charFolder}
              avatarSrc={placeholderSrc}
              onOpen={() => void onOpen(hip)}
              onRemove={() => askRemove(hip)}
            />
          ))}
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        className={hasProjects ? 'mt-3' : ''}
        disabled={busy}
        onClick={() => void onAddPick()}
      >
        <Plus /> {busy ? 'Linking…' : 'Add project'}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {pendingRemove && (
        <RemoveAssetDialog
          title="Remove Houdini project?"
          description="Unlink this Houdini project from the character."
          showDeleteFile={false}
          busy={busy}
          error={error}
          onConfirm={() => void confirmRemove()}
          onClose={() => setPendingRemove('')}
        />
      )}
    </FileDropZone>
  )
}

function CharacterPage() {
  const { projectId } = Route.useParams()
  const {
    character: initial,
    project,
    settings,
    catalog,
    location,
    sceneExists,
    sceneFolderExists,
    presetFrames: initialFrames,
    productScan,
  } = Route.useLoaderData()
  const router = useRouter()
  // The page owns a draft copy; "Save" persists it and revalidates the loader.
  const [character, setCharacter] = useState<Character>(initial)
  // Preset ROM block lengths, re-measured from the .duf assets whenever the
  // preset/custom selections change (kept from the last good measure during a
  // re-measure; null only when an included asset can't be read).
  const [presetFrames, setPresetFrames] = useState<PresetFrames | null>(initialFrames)
  // The last-persisted character. `dirty` compares against this — NOT the loader
  // data — so saving can settle the buttons in a single paint instead of waiting
  // on router.invalidate() to complete in a second, separate render.
  const [baseline, setBaseline] = useState<Character>(initial)
  const [saving, setSaving] = useState(false)
  const [storingProducts, setStoringProducts] = useState(false)
  const [expandedProducts, setExpandedProducts] = useState<Set<number>>(() => new Set())
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const swallowNavRef = useRef(false)
  // Power-user: holding Ctrl force-enables Save so the JSON can be re-written to
  // disk even when nothing changed (handy during development).
  const [ctrlHeld, setCtrlHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => e.key === 'Control' && setCtrlHeld(true)
    const up = (e: KeyboardEvent) => e.key === 'Control' && setCtrlHeld(false)
    const reset = () => setCtrlHeld(false) // don't get stuck "held" after alt-tab
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [])

  const dirty = JSON.stringify(character) !== JSON.stringify(baseline)

  // Re-measure the preset ROM block lengths when a preset/custom selection that
  // affects them changes (not on every custom-pose keystroke). Debounced; the
  // last good value is kept until the new one lands, so frame numbers don't
  // flicker. Null only when an included asset can't be read.
  const presetSignature = JSON.stringify({
    genesis: character.genesis,
    gender: character.gender,
    jcm: [
      character.sections.JCM.enabled,
      character.sections.JCM.mode,
      character.sections.JCM.presetAssets,
      character.sections.JCM.customAssetPath,
    ],
    gen: [character.sections.GEN.enabled, character.sections.GEN.mode, character.sections.GEN.presetAssets],
    phy: [character.sections.PHY.enabled, character.sections.PHY.mode],
  })
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      resolvePresetFrames(character, catalog)
        .then((frames) => !cancelled && setPresetFrames(frames))
        .catch(() => !cancelled && setPresetFrames(null))
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // character/catalog are captured fresh each render; presetSignature gates re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetSignature, catalog])

  // The character's folder, shown under the header with the project library root
  // dimmed as a label prefix and the rest emphasized. The definition filename is
  // dropped (it's edited in the Filepath fields below) — just the folder remains.
  const libRoot = displayPath(location?.libraryFolder ?? '')
  const defAbs = displayPath(location?.definitionAbs ?? '')
  const defSep = Math.max(defAbs.lastIndexOf('\\'), defAbs.lastIndexOf('/'))
  const defDir = defSep >= 0 ? defAbs.slice(0, defSep) : defAbs
  const defSuffix = defDir.startsWith(libRoot) ? defDir.slice(libRoot.length) : defDir
  // Where the generated <Name>_<Genesis>.dsa lands in the Daz library, so the
  // user knows where to find/run it in Daz. Empty until the DAZ library is set.
  const scriptsLib = displayPath(settings.dazLibraryFolder)
  const scriptsAbs =
    settings.dazLibraryFolder && character.projectName
      ? displayPath(
          studioCharScriptsDir(settings.dazLibraryFolder, character.projectName, character.name),
        )
      : ''
  const scriptsSuffix = scriptsAbs.startsWith(scriptsLib)
    ? scriptsAbs.slice(scriptsLib.length)
    : scriptsAbs
  // With an export folder set and the export NOT combined with the ROM script,
  // generation splits into a ROM_ build script + a standalone Export_ script
  // (see generate.ts toRomScriptDsa / toExportScriptDsa). Otherwise it's one
  // self-contained <Name>_<Genesis>.dsa. Drives the scripts-pane info note.
  const exportSet = character.exportPath.trim() !== ''
  const exportSplit = exportSet && character.exportWithRomScript === false

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
    void router.invalidate()
    notifyGenerated(`Renamed to “${next}”`, result)
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
      setSaving(false)
      // Refresh the loader for re-entry/navigation, but don't await it — the
      // buttons no longer depend on it, so it stays off the visible path.
      void router.invalidate()
      notifyGenerated(`Saved “${saved.name}” — ${result.files.length} files`, result)
    } catch (e) {
      setSaving(false)
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  // Export settings only take effect once the script is regenerated (the export
  // block is emitted at generation time), so persist + regenerate immediately —
  // like the inline rename — instead of leaving them as dirty edits a manual
  // Save might miss. Otherwise the on-disk script silently lags the chosen folder.
  async function patchAndRegenerate(p: Partial<Character>, toastMsg?: string) {
    const updated = { ...character, ...p }
    setCharacter(updated)
    try {
      const saved = await saveCharacter({ data: { projectId, character: updated } })
      const result = await generateCharacterFiles({ data: { projectId, id: saved.id } })
      setCharacter(saved)
      setBaseline(saved)
      void router.invalidate()
      notifyGenerated(toastMsg ?? `Saved “${saved.name}”`, result)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  // Store the most recent product scan onto the character. Products don't affect
  // generated scripts, so this just persists the draft + the scan fields — no
  // regeneration. Merges into the current draft so any in-progress edits are kept.
  async function storeProducts() {
    if (!productScan?.scan) return
    setStoringProducts(true)
    try {
      const next: Character = {
        ...character,
        products: productScan.scan.products,
        productsUnmatched: productScan.scan.unmatched,
        productsScannedAt: new Date().toISOString(),
      }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      setCharacter(saved)
      setBaseline(saved)
      void router.invalidate()
      toast.success(
        `Stored ${saved.products.length} product${saved.products.length === 1 ? '' : 's'} on “${saved.name}”`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setStoringProducts(false)
    }
  }

  // The Generate panel was dissolved — generation feedback is a concise toast
  // (the install location lives in Settings); a script-install error still warns.
  function notifyGenerated(title: string, result: GenerateResult) {
    toast.success(title)
    if (result.scriptsError) {
      toast.warning(`Couldn't install the character script: ${result.scriptsError}`)
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

  // --- Special operations (delete) ---
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // Whether the character has a Houdini subfolder on disk — gates the delete
  // dialog's "keep Houdini files" toggle (checked when the dialog opens).
  const [keepHoudiniAvailable, setKeepHoudiniAvailable] = useState(false)
  useEffect(() => {
    if (!deleteOpen) return
    let cancelled = false
    void characterKeepFolders({ data: { projectId, id: character.id } })
      .then((f) => !cancelled && setKeepHoudiniAvailable(f.houdini))
      .catch(() => !cancelled && setKeepHoudiniAvailable(false))
    return () => {
      cancelled = true
    }
  }, [deleteOpen, projectId, character.id])

  async function onPickExportDir() {
    const picked = await pickFolder('Choose the export directory for the DTH Exporter')
    if (picked) await patchAndRegenerate({ exportPath: picked }, 'Export folder set — script regenerated')
  }

  async function onDeleteCharacter({ keep, keep2 }: { keep: boolean; keep2: boolean }) {
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteCharacter({
        data: { projectId, id: character.id, keepDaz: keep, keepHoudini: keep2 },
      })
      toast.success(`Deleted “${character.name}”`)
      // Navigation unmounts this editor — no need to reset the busy flag.
      await router.navigate({ to: '/projects/$projectId', params: { projectId } })
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
    }
  }

  return (
    <main className="p-8">
      <div className="mb-1">
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
          <ArrowLeft className="size-4" /> Back to overview
        </Link>
      </div>

      <header className="sticky top-0 z-10 mb-8 flex items-end gap-5 bg-background">
        <button
          type="button"
          className="group relative mt-5 mb-5 shrink-0"
          title="Edit the character image"
          onClick={() => setImageDialogOpen(true)}
        >
          {/* The wrapper owns the shrink: only its height animates (227 → 96). It
              clips a fixed-size image via overflow-hidden, so the portrait is
              *cropped* top-down rather than re-fit every frame — the image is
              rasterized once and the box just changes its clip rect, which stays
              smooth even with the heavy form relaying out below the sticky header. */}
          <div className="avatar-scroll-shrink h-[227px] w-[130px] overflow-hidden rounded-lg bg-neutral-500">
            <Avatar
              image={character.image}
              name={character.name}
              className="avatar-scroll-pan h-[227px] w-[130px] object-top"
              fallbackClassName="text-6xl"
            />
          </div>
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
            <Pencil className="size-8 text-white" />
          </span>
        </button>
        <div className="title-scroll pb-6">
          <EditableTitle
            name={character.name}
            ariaLabel="Character name"
            onEditingChange={setEditingTitle}
            onSave={onRenameCharacter}
          />
          <p className="title-subtitle text-muted-foreground">
            {character.genesis} · {characterSkinning(character).toUpperCase()} ·{' '}
            {countPoses(character.sections)} custom ROM frames
          </p>
          {location && (
            <p className="mt-1.5 text-xs">
              <PathCode path={defDir}>
                <span className="text-muted-foreground/60">{libRoot}</span>
                <span className="text-foreground/80">{defSuffix}</span>
              </PathCode>
            </p>
          )}
        </div>
        {/* Bottom-right in the header, on the path-chip's baseline (mb-6 lifts the
            box so the scale below anchors on that line). They ride the sticky
            header, so they stay reachable as the form scrolls. */}
        <div className="actions-scroll ml-auto flex shrink-0 gap-2 mb-6">
          <Button variant="outline" onClick={onDiscard} disabled={saving || !dirty}>
            <Undo2 /> Discard
          </Button>
          <Button
            onClick={onSave}
            disabled={saving || (!dirty && !ctrlHeld)}
            title={ctrlHeld && !dirty ? 'Force re-save the JSON to disk (Ctrl)' : undefined}
          >
            <Save /> {saving ? 'Saving…' : dirty ? 'Save' : ctrlHeld ? 'Re-save' : 'Saved'}
          </Button>
        </div>
      </header>

      {/* The editor body is isolated with `contain: layout paint`: when the sticky
          header collapses on scroll its height changes, and without this the whole
          (heavy) form would re-flow every frame on the main thread — the lag. With
          containment the browser only re-positions this one cached layer. The two
          popup dialogs below are portaled to <body> so this containment doesn't
          become their containing block and break their viewport positioning. */}
      <div className="contain-editor-body">
      <section className="mb-8 rounded-lg border bg-card p-5 pt-7">
        <div className="flex flex-wrap gap-x-12 gap-y-5">
          <div className="flex flex-col gap-5 pt-2">
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
            </div>
          </div>

          {/* The legend is positioned absolutely (a notch on the border) so it
              doesn't consume a row of flow — that keeps the FACS / Flexion fields
              on the same baseline as the Genesis row on the left. -mt-2 + pt-2
              lift the box so its fields start at the same y as the left column. */}
          <fieldset className="relative -mt-2 self-start rounded-md border px-4 pt-4 pb-4">
            <legend className="absolute -top-2 left-3 bg-card px-1 text-xs font-medium text-muted-foreground uppercase">
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
            <DazSceneField
              projectId={projectId}
              character={character}
              location={location}
              sceneExists={sceneExists}
              sceneFolderExists={sceneFolderExists}
              defaultSubdir={project?.dazSubdir ?? 'daz3d'}
              onLinked={onSceneLinked}
            />
            <HoudiniProjectsField
              projectId={projectId}
              character={character}
              location={location}
              onChanged={onSceneLinked}
            />
          </div>
        )}
      </section>

      <section className="mb-8 rounded-lg border bg-card p-5">
        <h2 className="mb-3 flex w-fit items-center gap-1 text-xl font-semibold">
          Daz scripts generated
          <InfoPopup label="Daz scripts generated — more information">
            {exportSplit ? (
              <>
                Where the generated <code>ROM_{character.name}_{character.genesis}.dsa</code> (builds
                the ROM) and <code>Export_{character.name}_{character.genesis}.dsa</code> (runs the
                exporter) scripts are installed in your DAZ library on Save — run the ROM script
                first, then the Export script in the same Daz session.
              </>
            ) : (
              <>
                Where the generated <code>{character.name}_{character.genesis}.dsa</code> script is
                installed in your DAZ library on Save — open it from Daz to build the ROM
                {exportSet ? ' and run the export' : ''}.
              </>
            )}{' '}
            The folder is created the first time a script is generated.
          </InfoPopup>
        </h2>
        {scriptsAbs ? (
          <PathCode path={scriptsAbs}>
            <span className="text-muted-foreground/60">{scriptsLib}</span>
            <span className="text-foreground/80">{scriptsSuffix}</span>
          </PathCode>
        ) : (
          <p className="text-sm text-muted-foreground">
            Set “My DAZ 3D Library” in Settings to install the character script.
          </p>
        )}
      </section>

      {project?.dazProductsEnabled && (
        <section className="mb-8 rounded-lg border bg-card p-5">
          <h2 className="mb-3 flex w-fit items-center gap-1 text-xl font-semibold">
            Daz Products
            <InfoPopup label="Daz Products — more information">
              Open this character's scene in Daz and run the generated{' '}
              <code>Scan_Products_{characterSlug(character)}.dsa</code>. It analyses the open scene,
              matches the used assets to your installed products, and writes a CSV the studio reads
              back here — review the results below and store them on the character.
            </InfoPopup>
          </h2>

          {!settings.dimManifestsFolder.trim() && (
            <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
              No DAZ Install Manager manifests folder is set, so a scan can list used assets but
              can't name products.{' '}
              <Link to="/settings" className="underline">
                Set it in Settings → General
              </Link>
              .
            </p>
          )}

          <p className="mb-2 text-sm text-muted-foreground">
            Run <code>Scan_Products_{characterSlug(character)}.dsa</code> with this character's scene
            open in Daz, then check for results. Results are kept per scene — open each outfit/look
            variant and run it again to map products to every scene.
          </p>
          {scriptsAbs && (
            <PathCode path={scriptsAbs}>
              <span className="text-muted-foreground/60">{scriptsLib}</span>
              <span className="text-foreground/80">{scriptsSuffix}</span>
            </PathCode>
          )}

          <div className="mt-3 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void router.invalidate()}>
              Check for scan results
            </Button>
            {character.products.length > 0 && (
              <span className="text-sm text-muted-foreground">
                Stored: {character.products.length} product
                {character.products.length === 1 ? '' : 's'}
                {character.productsScannedAt
                  ? ` (${new Date(character.productsScannedAt).toLocaleString()})`
                  : ''}
              </span>
            )}
          </div>

          {productScan?.exists && productScan.scan ? (
            <div className="mt-4 rounded-md border p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <span className="font-medium">
                  Scan results — {productScan.scan.products.length} product
                  {productScan.scan.products.length === 1 ? '' : 's'}
                  {productScan.scan.unmatched.length
                    ? `, ${productScan.scan.unmatched.length} unmatched`
                    : ''}
                  {productScan.scan.scenes.length > 1
                    ? ` · across ${productScan.scan.scenes.length} scenes`
                    : productScan.scan.scenes.length === 1
                      ? ` · ${productScan.scan.scenes[0]}`
                      : ''}
                </span>
                <Button onClick={storeProducts} disabled={storingProducts}>
                  <Save />{' '}
                  {storingProducts
                    ? 'Storing…'
                    : character.products.length
                      ? 'Update stored products'
                      : 'Store on character'}
                </Button>
              </div>

              {productScan.scan.products.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="pr-3 pb-1 font-medium">Product</th>
                        <th className="pr-3 pb-1 font-medium">Used as</th>
                        <th className="pr-3 pb-1 font-medium">SKU</th>
                        <th className="pr-3 pb-1 font-medium">Artist</th>
                        <th className="pr-3 pb-1 font-medium">Version</th>
                        <th className="pr-3 pb-1 font-medium">Match</th>
                        {productScan.scan.scenes.length > 1 && (
                          <th className="pr-3 pb-1 font-medium">Scene(s)</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {productScan.scan.products.map((p, i) => {
                        const url = dazProductUrl(p.sku)
                        const multiScene = productScan.scan!.scenes.length > 1
                        const colCount = multiScene ? 7 : 6
                        const open = expandedProducts.has(i)
                        const assets = p.usedBy ? p.usedBy.split('; ').filter(Boolean) : []
                        return (
                          <Fragment key={`${p.sku}-${p.name}-${i}`}>
                            <tr className="border-t">
                              <td className="py-1 pr-3">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedProducts((prev) => {
                                      const next = new Set(prev)
                                      if (next.has(i)) next.delete(i)
                                      else next.add(i)
                                      return next
                                    })
                                  }
                                  className="mr-1 inline-flex align-middle text-muted-foreground hover:text-foreground"
                                  aria-label={open ? 'Hide matched assets' : 'Show matched assets'}
                                >
                                  {open ? (
                                    <ChevronDown className="size-3.5" />
                                  ) : (
                                    <ChevronRight className="size-3.5" />
                                  )}
                                </button>
                                {url ? (
                                  <a
                                    href={url}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      void openExternal(url)
                                    }}
                                    className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
                                    title="Open the Daz product page"
                                  >
                                    {p.name}
                                    <ExternalLink className="size-3.5 shrink-0" />
                                  </a>
                                ) : (
                                  p.name
                                )}
                              </td>
                              <td
                                className="py-1 pr-3 text-muted-foreground"
                                title={p.usedBy ? `Used by: ${p.usedBy}` : undefined}
                              >
                                {p.usage || '—'}
                              </td>
                              <td className="py-1 pr-3 text-muted-foreground">{p.sku}</td>
                              <td className="py-1 pr-3 text-muted-foreground">{p.artist}</td>
                              <td className="py-1 pr-3 text-muted-foreground">{p.version}</td>
                              <td className="py-1 pr-3 text-muted-foreground">{p.matchMethod}</td>
                              {multiScene && (
                                <td className="py-1 pr-3 text-muted-foreground">
                                  {p.scenes.join(', ')}
                                </td>
                              )}
                            </tr>
                            {open && (
                              <tr className="bg-muted/20">
                                <td colSpan={colCount} className="px-3 py-2 pl-7">
                                  <div className="mb-1 text-xs text-muted-foreground">
                                    Found by {assets.length} scene asset
                                    {assets.length === 1 ? '' : 's'}
                                    {multiScene ? ` · in ${p.scenes.join(', ')}` : ''}
                                  </div>
                                  {assets.length ? (
                                    <ul className="space-y-0.5 text-sm">
                                      {assets.map((a, j) => (
                                        <li key={`${a}-${j}`} className="text-foreground/80">
                                          {a}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <span className="text-sm text-muted-foreground">
                                      No specific scene assets were recorded for this product.
                                    </span>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No products matched. The assets below are what the scan found in the scene.
                </p>
              )}

              {productScan.scan.unmatched.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    {productScan.scan.unmatched.length} unmatched asset
                    {productScan.scan.unmatched.length === 1 ? '' : 's'} (no product match)
                  </summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {productScan.scan.unmatched.map((a, i) => (
                      <li key={`${a.technicalName}-${a.name}-${i}`}>
                        <span className="text-foreground/80">{a.name}</span>{' '}
                        <span className="text-muted-foreground">
                          ({a.assetType}
                          {a.artist ? ` — ${a.artist}` : ''}
                          {a.version ? ` v${a.version}` : ''}
                          {a.sourceFile ? ` — ${displayPath(a.sourceFile)}` : ''})
                          {productScan.scan!.scenes.length > 1 && a.scenes.length
                            ? ` · ${a.scenes.join(', ')}`
                            : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No scan results found yet. Run the script in Daz, then click “Check for scan results”.
            </p>
          )}
        </section>
      )}

      <section className="mb-8 rounded-lg border bg-card p-5">
        <h2 className="mb-4 flex w-fit items-center gap-1 text-xl font-semibold">
          Export directory
          <InfoPopup label="Export directory — more information">
            Set an export directory and the generated Daz script runs the DTH Exporter Plugin
            (v1.8.1+) automatically after building the ROM — writing{' '}
            {character.exportPath ? (
              <>
                <code>{character.name}</code>.abc / .dth and copying the PoseAsset CSV into that
                folder
              </>
            ) : (
              'straight into the DTH pipeline'
            )}
            . Leave empty to skip auto-export. Reference frames are taken from the ROM's
            reference-skeleton poses.
          </InfoPopup>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={onPickExportDir}>
            <FolderOpen /> {character.exportPath ? 'Change…' : 'Choose folder…'}
          </Button>
          {character.exportPath && (
            <>
              <PathCode path={displayPath(character.exportPath)} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void patchAndRegenerate({ exportPath: '' }, 'Export folder cleared — script regenerated')}
              >
                <X /> Clear
              </Button>
            </>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Switch
            checked={character.exportSceneSubfolders}
            disabled={!character.exportPath}
            onCheckedChange={(exportSceneSubfolders) =>
              void patchAndRegenerate(
                { exportSceneSubfolders },
                `Scene subfolders ${exportSceneSubfolders ? 'on' : 'off'} — script regenerated`,
              )
            }
          />
          <span
            className={`flex items-center gap-1 text-sm${character.exportPath ? '' : ' text-muted-foreground'}`}
          >
            Generate subfolders based on Daz scenes
            <InfoPopup label="Generate subfolders based on Daz scenes — more information">
              When on, the export is nested under a subfolder named after the Daz scene open in Daz
              when the script runs (resolved at run time) — so a character's scene/outfit variants
              export side by side. The exporter output and the PoseAsset CSV land directly in that
              scene subfolder. Falls back to the export root if no scene is saved.{' '}
              {!character.exportPath && 'Set an export folder above to enable this.'}
            </InfoPopup>
          </span>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Switch
            checked={character.exportWithRomScript}
            disabled={!character.exportPath}
            onCheckedChange={(exportWithRomScript) =>
              void patchAndRegenerate(
                { exportWithRomScript },
                exportWithRomScript
                  ? 'Combined ROM + export script'
                  : 'Separate ROM and Export scripts',
              )
            }
          />
          <span
            className={`flex items-center gap-1 text-sm${character.exportPath ? '' : ' text-muted-foreground'}`}
          >
            Run the export with the ROM script
            <InfoPopup label="Run the export with the ROM script — more information">
              On: one <code>{character.name}_{character.genesis}.dsa</code> builds the ROM and runs
              the export. Off: the ROM build (
              <code>ROM_{character.name}_{character.genesis}.dsa</code>) and the export (
              <code>Export_{character.name}_{character.genesis}.dsa</code>) split into two scripts, so
              you can re-export — for another Daz scene, or after a failed export — without rebuilding
              the ROM. Run the Export script after the ROM script in the same Daz session.{' '}
              {!character.exportPath && 'Set an export folder above to enable this.'}
            </InfoPopup>
          </span>
        </div>
      </section>

      <details className="mb-8 rounded-lg border bg-card">
        <summary className="cursor-pointer px-5 py-3 font-medium select-none">
          Advanced options
        </summary>
        <div className="space-y-6 border-t p-5">
          <StorageLocation
            projectId={projectId}
            id={character.id}
            location={location}
            onMoved={onCharacterMoved}
          />
          <div className="flex items-center gap-3">
            <Switch
              checked={character.resetGenBeforeApplying}
              onCheckedChange={(resetGenBeforeApplying) => patch({ resetGenBeforeApplying })}
            />
            <span className="flex items-center gap-1 text-sm">
              Reset genitalia morphs before extra frames
              <InfoPopup label="Reset genitalia morphs before extra frames — more information">
                Zeroes the active genital ROM (Golden Palace or Dicktator) at the first custom
                frame, so its morphs don't leak into your full-body and custom poses.
              </InfoPopup>
            </span>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-5">
            <div>
              <Label className="mb-2 flex w-fit items-center gap-1">
                Preserve morphs after ROM loading
                <InfoPopup label="Preserve morphs after ROM loading — more information">
                  Morphs listed here are restored to the value you set after the DTH ROM loads —
                  which otherwise zeroes them. Use it for body-shaping controls (e.g. breast or
                  muscle morphs) you want to keep across the ROM. Enter the morph's property name
                  and its hold value.
                </InfoPopup>
              </Label>
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
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({ preserveMorphs: [...character.preserveMorphs, { name: '', keepValue: 1 }] })
                }
              >
                <Plus /> Add morph
              </Button>
            </div>
            <div>
              <Label className="mb-2 flex w-fit items-center gap-1">
                Preserve node transforms (e.g. eyes)
                <InfoPopup label="Preserve node transforms — more information">
                  A node's transform is memorized before the ROM loads and restored afterwards, so
                  posed nodes (e.g. eyes) keep their orientation instead of being reset. Enter the
                  node's label as it appears in Daz.
                </InfoPopup>
              </Label>
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
                variant="outline"
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
        <h2 className="mb-3 flex w-fit items-center gap-1 text-xl font-semibold">
          ROM
          <InfoPopup label="ROM — more information">
            The eight pose asset categories in their canonical order. Pre-defined sections load
            the DTH ROMs; custom sections define their own groups and poses. Frame numbers follow
            section, group and pose order — the generated Daz script and PoseAsset CSV share them
            automatically.
          </InfoPopup>
        </h2>
        <RomSections
          sections={character.sections}
          genesis={character.genesis}
          gender={character.gender}
          skinning={characterSkinning(character)}
          catalog={catalog}
          presetFrames={presetFrames}
          onChange={(sections) => patch({ sections })}
        />
      </section>

      {imageDialogOpen && (
        <ImageDialog
          image={character.image}
          name={character.name}
          characterId={character.id}
          scenes={[...new Set([character.scenePath, ...character.extraScenes].filter(Boolean))]}
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

      <section className="mt-8 rounded-lg border border-destructive/30 bg-card p-5">
        <h2 className="mb-1 text-xl font-semibold">Operations</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Delete this character from the project.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button variant="destructive" onClick={() => setDeleteOpen(true)} disabled={deleting}>
            <Trash2 /> Delete
          </Button>
        </div>
      </section>
      </div>

      {deleteOpen && (
        <BulkDeleteDialog
          noun="character"
          names={[character.name]}
          message="This removes the character folder and its generated files. This cannot be undone."
          keepLabel={
            <>
              Keep the Daz files folder{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {project?.dazSubdir ?? 'daz3d'}
              </code>
            </>
          }
          keep2Label={
            keepHoudiniAvailable ? (
              <>
                Keep the Houdini files folder{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  {project?.houdiniSubdir ?? 'houdini'}
                </code>
              </>
            ) : undefined
          }
          busy={deleting}
          error={deleteError}
          onConfirm={onDeleteCharacter}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </main>
  )
}
