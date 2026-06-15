import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { ArrowLeft, FolderOpen, Settings as SettingsIcon, Trash2, UserPlus } from 'lucide-react'

import { useResolvedImage } from '#/components/avatar.tsx'
import { EditableTitle } from '#/components/editable-title.tsx'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select.tsx'
import {
  copyDazScene,
  createCharacter,
  deleteCharacter,
  fetchCharacters,
  fetchProject,
  resolveScenePreview,
  updateProject,
} from '#/lib/rom/api.ts'
import { pickDufPath } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { PathCode } from '#/components/path-code.tsx'

import { characterSkinning, countPoses } from '@dth/rom'

import type { Gender, GenesisVersion } from '@dth/rom'

/**
 * Overview card thumbnail: a portrait crop of the (square) Daz preview image,
 * zoomed 200% and anchored to the top — `background-size: auto 200%` makes the
 * image height twice the box, so a 3:4 box shows the top 50% vertically and a
 * centered portrait slice horizontally. Light gray fills any transparency.
 */
function CharacterThumb({ image, name }: { image: string; name: string }) {
  const src = useResolvedImage(image)
  return (
    <div className="aspect-[3/4] w-16 shrink-0 overflow-hidden rounded-md bg-neutral-300">
      {src ? (
        <div
          className="size-full bg-no-repeat"
          style={{
            backgroundImage: `url("${src}")`,
            backgroundSize: 'auto 230%',
            backgroundPosition: 'center -5px',
          }}
        />
      ) : (
        <div className="flex size-full items-center justify-center bg-muted text-2xl font-bold text-muted-foreground">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  )
}

/** Live preview of the picked Daz scene's tip thumbnail (read as a data URL). */
function ScenePreview({ scenePath }: { scenePath: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let active = true
    if (!scenePath.trim()) {
      setSrc('')
      return
    }
    resolveScenePreview(scenePath.trim())
      .then((s) => active && setSrc(s))
      .catch(() => active && setSrc(''))
    return () => {
      active = false
    }
  }, [scenePath])
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      className="aspect-[3/4] w-32 rounded-lg bg-neutral-300 object-cover"
    />
  )
}

export const Route = createFileRoute('/projects/$projectId/')({
  loader: async ({ params }) => {
    const project = await fetchProject({ data: { projectId: params.projectId } })
    if (!project) throw notFound()
    const characters = await fetchCharacters({ data: { projectId: params.projectId } })
    return { project, characters }
  },
  component: ProjectCharactersPage,
})

function ProjectCharactersPage() {
  const { projectId } = Route.useParams()
  const { project, characters } = Route.useLoaderData()
  const router = useRouter()
  const [scenePath, setScenePath] = useState('')
  const [filepath, setFilepath] = useState('')
  const [genesis, setGenesis] = useState<GenesisVersion>('G9')
  const [gender, setGender] = useState<Gender>('female')
  const [prefill, setPrefill] = useState<'empty' | 'example'>('empty')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  // When the picked scene is outside the project, the create flow pauses on this
  // modal to ask whether to copy the scene into the character folder.
  const [copyPrompt, setCopyPrompt] = useState(false)
  const [copySubfolder, setCopySubfolder] = useState('daz3d')
  const swallowNavRef = useRef(false)

  /** Filename without extension, e.g. "X:\…\Kira.duf" → "Kira". */
  function sceneBaseName(p: string): string {
    return (p.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? '').replace(/\.duf$/i, '')
  }

  /** Split the "Filepath" field into a subfolder (relative to the project) + name. */
  function parseFilepath(fp: string): { relFolder: string; name: string } {
    const clean = fp.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const slash = clean.lastIndexOf('/')
    const relFolder = slash >= 0 ? clean.slice(0, slash) : ''
    const name = (slash >= 0 ? clean.slice(slash + 1) : clean).replace(/\.json$/i, '')
    return { relFolder, name }
  }

  async function onPickScene() {
    const picked = await pickDufPath('Select the Daz character scene (.duf)')
    if (!picked) return
    setScenePath(picked)
    // Prefill the filepath as "<base>/<base>.json" (the user can edit it).
    const base = sceneBaseName(picked)
    setFilepath(displayPath(`${base}/${base}.json`))
  }

  /** Is the picked scene located inside the project folder? */
  function sceneInsideProject(): boolean {
    const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
    return norm(scenePath).startsWith(norm(project.path) + '/')
  }

  async function onCreate() {
    if (!scenePath.trim() || !parseFilepath(filepath).name) return
    // Scene outside the project → ask whether to copy it into the character folder.
    if (!sceneInsideProject()) {
      setCopySubfolder('daz3d')
      setCopyPrompt(true)
      return
    }
    await doCreate(false)
  }

  /** Create the character; when `copyScene`, also copy the scene + its thumbnails. */
  async function doCreate(copyScene: boolean) {
    const { relFolder, name } = parseFilepath(filepath)
    setBusy(true)
    setError('')
    try {
      const character = await createCharacter({
        data: {
          projectId,
          name,
          genesis,
          gender,
          scenePath: scenePath.trim(),
          relFolder,
          prefill,
        },
      })
      if (copyScene) {
        await copyDazScene({
          data: {
            projectId,
            characterId: character.id,
            scenePath: scenePath.trim(),
            subfolder: copySubfolder.trim(),
          },
        })
      }
      setCopyPrompt(false)
      setScenePath('')
      setFilepath('')
      setPrefill('empty')
      await router.invalidate()
      toast.success(`Created “${character.name}”`)
      await router.navigate({
        to: '/projects/$projectId/characters/$characterId',
        params: { projectId, characterId: character.id },
      })
    } catch (e) {
      setCopyPrompt(false)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string, characterName: string) {
    if (!window.confirm(`Delete character "${characterName}"? This cannot be undone.`)) return
    await deleteCharacter({ data: { projectId, id } })
    await router.invalidate()
    toast.success(`Deleted “${characterName}”`)
  }

  return (
    <main className="p-8">
      <div className="mb-6">
        <Link
          to="/"
          onMouseDown={() => {
            // While the title is being edited, the first click here just commits
            // and closes the edit (via the input's blur) — it must not navigate.
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
          <ArrowLeft className="size-4" /> All projects
        </Link>
      </div>

      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <EditableTitle
            name={project.name}
            ariaLabel="Project name"
            onEditingChange={setEditingTitle}
            onSave={async (next) => {
              await updateProject({ data: { id: projectId, name: next } })
              await router.invalidate()
              toast.success('Project renamed')
            }}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            <PathCode path={displayPath(project.path)} />
          </p>
        </div>
        <Link
          to="/settings"
          className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <SettingsIcon className="size-4" /> Settings
        </Link>
      </header>

      <div className="mb-8 max-w-5xl space-y-3 rounded-lg border bg-card p-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Daz Character Scene</label>
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              placeholder="X:\…\Kira.duf"
              value={scenePath}
              onChange={(e) => setScenePath(e.target.value)}
            />
            <Button type="button" variant="outline" className="shrink-0" onClick={onPickScene}>
              <FolderOpen /> Browse
            </Button>
          </div>
        </div>

        {scenePath.trim() && (
          <div className="flex flex-wrap items-start gap-4">
            <ScenePreview scenePath={scenePath} />
            <div className="min-w-[20rem] flex-1 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[16rem] flex-1">
                  <label className="mb-1 block text-sm font-medium">Filepath</label>
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 shrink-0 items-center rounded-md border bg-muted px-2.5 font-mono text-xs text-muted-foreground">
                      {displayPath('/project/')}
                    </span>
                    <Input
                      className="flex-1"
                      placeholder={displayPath('Kira/Kira.json')}
                      value={filepath}
                      onChange={(e) => setFilepath(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && onCreate()}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Genesis</label>
                  <Select value={genesis} onValueChange={(v) => setGenesis(v as GenesisVersion)}>
                    <SelectTrigger className="w-24">
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
                  <label className="mb-1 block text-sm font-medium">Gender</label>
                  <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={onCreate} disabled={busy || !parseFilepath(filepath).name}>
                  <UserPlus /> Create
                </Button>
              </div>

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Optional: Prefill</label>
                <Select value={prefill} onValueChange={(v) => setPrefill(v as 'empty' | 'example')}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="empty">Empty</SelectItem>
                    <SelectItem value="example">Example</SelectItem>
                  </SelectContent>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  “Example” seeds the ROM definitions from the bundled example character.
                </p>
                {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
              </div>
            </div>
          </div>
        )}
      </div>

      {characters.length === 0 ? (
        <p className="text-muted-foreground">No characters yet — create the first one above.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {characters.map((character) => (
            <li
              key={character.id}
              className="group relative overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary"
            >
              <Link
                to="/projects/$projectId/characters/$characterId"
                params={{ projectId, characterId: character.id }}
                className="flex items-center gap-4 p-4"
              >
                <CharacterThumb image={character.image} name={character.name} />
                <div>
                  <div className="font-semibold">{character.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {character.genesis} · {characterSkinning(character).toUpperCase()} ·{' '}
                    {countPoses(character.sections)} custom frames
                  </div>
                </div>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100"
                title="Delete character"
                onClick={() => onDelete(character.id, character.name)}
              >
                <Trash2 className="text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {copyPrompt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setCopyPrompt(false)}
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
              <label className="mb-1 block text-sm font-medium">Subfolder</label>
              <Input
                value={copySubfolder}
                placeholder="(character folder root)"
                onChange={(e) => setCopySubfolder(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void doCreate(false)}>
                Don't copy
              </Button>
              <Button disabled={busy} onClick={() => void doCreate(true)}>
                {busy ? 'Copying…' : 'Copy & create'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
