import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { ArrowLeft, FolderOpen, Settings as SettingsIcon, Trash2, UserPlus } from 'lucide-react'

import { Field } from '#/components/field.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { SceneCopyDialog } from '#/components/scene-copy-dialog.tsx'
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
  fetchSettings,
  generateCharacterFiles,
  resolveScenePreview,
  saveCharacter,
  updateProject,
} from '#/lib/rom/api.ts'
import { pickDufPath } from '#/lib/desktop.ts'
import { displayPath, pathSeparator } from '#/lib/path.ts'
import { PathCode } from '#/components/path-code.tsx'

import { characterSkinning, countPoses } from '@dth/rom'

import type { Gender, GenesisVersion } from '@dth/rom'

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
      className="aspect-[130/227] w-32 rounded-lg bg-neutral-500 object-cover object-top"
    />
  )
}

export const Route = createFileRoute('/projects/$projectId/')({
  loader: async ({ params }) => {
    const project = await fetchProject({ data: { projectId: params.projectId } })
    if (!project) throw notFound()
    const [characters, settings] = await Promise.all([
      fetchCharacters({ data: { projectId: params.projectId } }),
      fetchSettings(),
    ])
    return { project, characters, settings }
  },
  component: ProjectCharactersPage,
})

function ProjectCharactersPage() {
  const { projectId } = Route.useParams()
  const { project, characters, settings } = Route.useLoaderData()
  const router = useRouter()
  const [scenePath, setScenePath] = useState('')
  const [name, setName] = useState('')
  const [genesis, setGenesis] = useState<GenesisVersion>('G9')
  const [gender, setGender] = useState<Gender>('female')
  // 'empty' | 'example' | an existing character's id (copy its ROM definitions).
  const [prefill, setPrefill] = useState<string>('empty')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  // When the picked scene is outside the project, the create flow pauses on this
  // modal to ask whether to copy the scene into the character folder.
  const [copyPrompt, setCopyPrompt] = useState(false)
  // The scenes folder for a new character is editable (default from Settings);
  // the subfolder is the optional nested path inside it (empty = the base root).
  const [copyBase, setCopyBase] = useState(settings.dazSubdir)
  const [copySubfolder, setCopySubfolder] = useState('')
  const [copyDeleteOriginal, setCopyDeleteOriginal] = useState(false)
  const swallowNavRef = useRef(false)

  /** Filename without extension, e.g. "X:\…\Kira.duf" → "Kira". */
  function sceneBaseName(p: string): string {
    return (p.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? '').replace(/\.duf$/i, '')
  }

  // The character's folder (and its JSON filename) are created from the name, so
  // disallow a trailing ".json".
  const nameTrimmed = name.trim()
  const nameError = /\.json$/i.test(nameTrimmed) ? 'A character name can’t end in “.json”.' : ''
  const canCreate = Boolean(nameTrimmed) && !nameError
  // ROM-prefill candidates: existing characters that match the chosen G + gender.
  const prefillChars = characters.filter((c) => c.genesis === genesis && c.gender === gender)

  async function onPickScene() {
    const picked = await pickDufPath('Select the Daz character scene (.duf)')
    if (!picked) return
    setScenePath(picked)
    // Prefill the name from the scene's filename (the folder is created from it).
    setName(sceneBaseName(picked))
  }

  /** Is the picked scene located inside the project folder? */
  function sceneInsideProject(): boolean {
    const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
    return norm(scenePath).startsWith(norm(project.path) + '/')
  }

  async function onCreate() {
    if (!scenePath.trim() || !canCreate) return
    // Scene outside the project → ask whether to copy it into the character folder.
    if (!sceneInsideProject()) {
      setCopyBase(settings.dazSubdir)
      setCopySubfolder('')
      setCopyDeleteOriginal(false)
      setCopyPrompt(true)
      return
    }
    await doCreate(false)
  }

  /** Create the character; when `copyScene`, also copy the scene + its thumbnails. */
  async function doCreate(copyScene: boolean) {
    // ROM prefill is 'empty' / 'example', or an existing character's id to copy.
    const fromChar = prefill !== 'empty' && prefill !== 'example'
    setBusy(true)
    setError('')
    try {
      let character = await createCharacter({
        data: {
          projectId,
          name: nameTrimmed,
          genesis,
          gender,
          scenePath: scenePath.trim(),
          relFolder: nameTrimmed,
          prefill: fromChar ? 'empty' : prefill,
          prefillFromId: fromChar ? prefill : undefined,
        },
      })
      if (copyScene) {
        // Copying brings the scene into the character folder — repoint the
        // stored scenePath at that in-project copy (createCharacter recorded the
        // original external path).
        const base = copyBase.split(/[\\/]+/).filter(Boolean).join('/')
        const nested = copySubfolder.split(/[\\/]+/).filter(Boolean).join('/')
        const movedScene = await copyDazScene({
          data: {
            projectId,
            characterId: character.id,
            scenePath: scenePath.trim(),
            subfolder: [base, nested].filter(Boolean).join('/'),
            deleteOriginal: copyDeleteOriginal,
          },
        })
        character = await saveCharacter({
          data: { projectId, character: { ...character, scenePath: movedScene } },
        })
      }
      // Generate the initial files so they exist + match the UI right away — the
      // editor's Save starts disabled (nothing dirty), so it wouldn't otherwise.
      try {
        await generateCharacterFiles({ data: { projectId, id: character.id } })
      } catch {
        // Non-fatal — the editor's Save can regenerate.
      }
      setCopyPrompt(false)
      setScenePath('')
      setName('')
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

      <div className="mb-8 max-w-5xl space-y-4 rounded-lg border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">Create character</h2>
          <p className="text-sm text-muted-foreground">
            Create a character by choosing its Daz scene file.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" className="shrink-0" onClick={onPickScene}>
            <FolderOpen /> {scenePath.trim() ? 'Choose another…' : 'Choose Daz scene…'}
          </Button>
          {scenePath.trim() && (
            <span className="truncate font-mono text-xs text-muted-foreground">
              {sceneBaseName(scenePath)}.duf
            </span>
          )}
        </div>

        {scenePath.trim() && (
          <>
            <div className="flex flex-wrap items-start gap-4">
              <ScenePreview scenePath={scenePath} />
              <div className="min-w-[20rem] flex-1 space-y-4">
                <div className="flex flex-wrap items-start gap-3">
                  <Field label="Character name" error={nameError} className="min-w-[14rem] flex-1">
                    {/* The folder is created from the name, so it carries the
                        project-path prefix. */}
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 shrink-0 items-center rounded-md border bg-muted px-2.5 font-mono text-xs text-muted-foreground">
                        {displayPath('/project/')}
                      </span>
                      <Input
                        className="min-w-0 flex-1"
                        placeholder="KiraDefault_G9_GP"
                        value={name}
                        aria-invalid={nameError ? true : undefined}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && onCreate()}
                      />
                    </div>
                  </Field>
                  <Field label="Genesis" className="shrink-0">
                    <Select
                      value={genesis}
                      onValueChange={(v) => {
                        setGenesis(v as GenesisVersion)
                        setPrefill('empty')
                      }}
                    >
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
                  </Field>
                  <Field label="Gender" className="shrink-0">
                    <Select
                      value={gender}
                      onValueChange={(v) => {
                        setGender(v as Gender)
                        setPrefill('empty')
                      }}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="male">Male</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>

                <Field label="ROM prefill" className="w-72">
                  <Select value={prefill} onValueChange={setPrefill}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="empty">Empty</SelectItem>
                      <SelectItem value="example">Example</SelectItem>
                      {prefillChars.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Copy the ROM definitions from the bundled example or an existing {genesis}{' '}
                    {gender} character.
                  </p>
                </Field>
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end">
              <Button onClick={onCreate} disabled={busy || !canCreate}>
                <UserPlus /> Create
              </Button>
            </div>
          </>
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
                <Portrait
                  image={character.image}
                  name={character.name}
                  className="aspect-[3/4] w-16 shrink-0 rounded-md"
                  fallbackClassName="text-2xl"
                />
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
        <SceneCopyDialog
          title="Copy Daz scene files?"
          description="Do you want to copy the Daz scene files into the character's folder structure?"
          baseValue={copyBase}
          onBaseChange={setCopyBase}
          separator={pathSeparator()}
          subfolder={copySubfolder}
          onSubfolderChange={setCopySubfolder}
          deleteOriginal={copyDeleteOriginal}
          onDeleteOriginalChange={setCopyDeleteOriginal}
          busy={busy}
          error={error}
          copyLabel="Copy & create"
          onCopy={() => void doCreate(true)}
          onLink={() => void doCreate(false)}
          onClose={() => setCopyPrompt(false)}
        />
      )}
    </main>
  )
}
