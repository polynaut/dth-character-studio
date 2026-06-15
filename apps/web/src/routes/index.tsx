import { useState } from 'react'
import { Link, createFileRoute, useRouter } from '@tanstack/react-router'
import { FileJson, Settings as SettingsIcon, Trash2, UserPlus } from 'lucide-react'

import { Avatar } from '#/components/avatar.tsx'
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
  importCharacterFromJson,
} from '#/lib/rom/api.ts'

import { characterSkinning, countPoses } from '@dth/rom'

import type { Gender, GenesisVersion } from '@dth/rom'

export const Route = createFileRoute('/')({
  loader: () => fetchCharacters(),
  component: CharactersPage,
})

function CharactersPage() {
  const characters = Route.useLoaderData()
  const router = useRouter()
  const [name, setName] = useState('')
  const [genesis, setGenesis] = useState<GenesisVersion>('G9')
  const [gender, setGender] = useState<Gender>('female')
  const [importPath, setImportPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onCreate() {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    try {
      const character = importPath.trim()
        ? await importCharacterFromJson({
            data: { name: name.trim(), genesis, gender, filePath: importPath.trim() },
          })
        : await createCharacter({ data: { name: name.trim(), genesis, gender } })
      setName('')
      setImportPath('')
      await router.invalidate()
      await router.navigate({ to: '/characters/$id', params: { id: character.id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string, characterName: string) {
    if (!window.confirm(`Delete character "${characterName}"? This cannot be undone.`)) return
    await deleteCharacter({ data: { id } })
    await router.invalidate()
  }

  return (
    <main className="mx-auto max-w-5xl p-8">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Characters</h1>
          <p className="mt-1 text-muted-foreground">
            One definition per character — Daz ROM scripts and the Houdini PoseAsset CSV are
            generated from it, so they always match.
          </p>
        </div>
        <Link
          to="/settings"
          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <SettingsIcon className="size-4" /> Settings
        </Link>
      </header>

      <div className="mb-10 space-y-3 rounded-lg border bg-card p-4">
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
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((character) => (
            <li
              key={character.id}
              className="group relative overflow-hidden rounded-lg border bg-card transition-colors hover:border-primary"
            >
              <Link
                to="/characters/$id"
                params={{ id: character.id }}
                className="flex items-center gap-4 p-4"
              >
                <Avatar
                  image={character.image}
                  name={character.name}
                  className="size-16 rounded-md"
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
    </main>
  )
}
