import { useRef, useState } from 'react'
import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { ArrowLeft, FileJson, Settings as SettingsIcon, Trash2, UserPlus } from 'lucide-react'

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
  createCharacter,
  deleteCharacter,
  fetchCharacters,
  fetchProject,
  importCharacterFromJson,
  updateProject,
} from '#/lib/rom/api.ts'
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
            backgroundSize: 'auto 220%',
            backgroundPosition: 'center -10px',
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
  const [name, setName] = useState('')
  const [genesis, setGenesis] = useState<GenesisVersion>('G9')
  const [gender, setGender] = useState<Gender>('female')
  const [importPath, setImportPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const swallowNavRef = useRef(false)

  async function onCreate() {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const character = importPath.trim()
        ? await importCharacterFromJson({
            data: { projectId, name: name.trim(), genesis, gender, filePath: importPath.trim() },
          })
        : await createCharacter({ data: { projectId, name: name.trim(), genesis, gender } })
      setName('')
      setImportPath('')
      await router.invalidate()
      toast.success(`Created “${character.name}”`)
      await router.navigate({
        to: '/projects/$projectId/characters/$characterId',
        params: { projectId, characterId: character.id },
      })
    } catch (e) {
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
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">Name</label>
            <Input
              placeholder="e.g. Electra G9"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onCreate()}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Genesis</label>
            <Select value={genesis} onValueChange={(v) => setGenesis(v as GenesisVersion)}>
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
          <Button onClick={onCreate} disabled={busy || !name.trim()}>
            {importPath.trim() ? <FileJson /> : <UserPlus />}
            {importPath.trim() ? 'Import' : 'Create'}
          </Button>
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Optional: seed from an existing DazToHue-Scripts FBM JSON (absolute path)
          </label>
          <Input
            placeholder="e.g. D:\Development\DazToHue-Scripts\ElectraG9_FBMs.json"
            value={importPath}
            onChange={(e) => setImportPath(e.target.value)}
          />
          {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        </div>
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
    </main>
  )
}
