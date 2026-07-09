import { useEffect, useState } from 'react'
import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { FolderOpen, UserPlus } from 'lucide-react'

import { Button, EditableTitle, Field, InfoPopup, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SidePanel, Tabs, TabsContent, TabsList, TabsTrigger, Tag, cn } from '@dth/ui'
import { Portrait } from '#/components/portrait.tsx'
import { SceneCopyDialog } from '#/components/scene-copy-dialog.tsx'
import { BulkDeleteDialog } from '#/components/bulk-delete-dialog.tsx'
import { AssetsGrid } from '#/components/assets-grid.tsx'
import { AssetForm } from '#/components/asset-form.tsx'
import {
  FilterSelect,
  SelectCheckbox,
  SelectionBar,
  SortSelect,
  ViewToggle,
  formatDate,
  sortItems,
  type SortKey,
  type ViewMode,
} from '#/components/overview-controls.tsx'
import { usePersistentState } from '#/lib/use-persistent-state.ts'
import { useSelection } from '#/lib/use-selection.ts'
import { toast } from 'sonner'
import {
  characterKeepFolders,
  copyDazScene,
  createCharacter,
  deleteCharacter,
  fetchAllCharacters,
  fetchCharacters,
  fetchProject,
  generateCharacterFiles,
  renameProject,
  resolveScenePreview,
  saveCharacter,
  setActiveProjectDir,
} from '#/lib/rom/api.ts'
import { pickDufPath } from '#/lib/desktop.ts'
import { useFileDrop } from '#/lib/file-drop.ts'
import { displayPath, pathSeparator } from '#/lib/path.ts'
import { PathCode } from '#/components/path-code.tsx'
import { HeaderNav } from '#/components/header-nav.tsx'
import { UnrealProjectsBar } from '#/components/unreal-projects-field.tsx'
import { NotesEditor } from '#/components/notes-editor.tsx'

import { characterSkinning, countPoses } from '@dth/rom'

import type { CharacterWithProject } from '#/lib/rom/api.ts'
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
    // The route param IS the project's folder path. Pin it as the active project so
    // avatars (in its `.dcsmeta`) resolve for this window.
    setActiveProjectDir(params.projectId)
    const project = await fetchProject({ data: { projectId: params.projectId } })
    if (!project) throw notFound()
    // Deliberately NOT fetching the cross-project prefill candidates here: that
    // walks EVERY recent project's library, and one cold network share would
    // stall this whole page. They load lazily when the prefill picker opens.
    const characters = await fetchCharacters({ data: { projectId: params.projectId } })
    return { project, characters }
  },
  component: ProjectCharactersPage,
})

function ProjectCharactersPage() {
  const { projectId } = Route.useParams()
  const { project, characters } = Route.useLoaderData()
  // The reusable Daz-scene "assets" feature is opt-in per project (its manifest).
  // Off → the project shows characters only (no Assets tab).
  const assetsEnabled = project.assetsEnabled
  const router = useRouter()
  const [scenePath, setScenePath] = useState('')
  const [name, setName] = useState('')
  const [genesis, setGenesis] = useState<GenesisVersion>('G9')
  const [gender, setGender] = useState<Gender>('female')
  // 'empty' | an existing character's id (copy its ROM definitions).
  const [prefill, setPrefill] = useState<string>('empty')
  // Cross-project ROM-prefill candidates. Loaded lazily the first time the
  // prefill picker opens (null until then) — fetching them walks every recent
  // project's library, which must never block opening the project page.
  const [allCharacters, setAllCharacters] = useState<Array<CharacterWithProject> | null>(null)
  const [prefillLoading, setPrefillLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // The create-character form lives in a slide-in side panel now. The panel and the
  // listing each carry a tab — "characters" (the existing flow) vs "assets" (reusable
  // Daz scenes scoped to this project). `assetRefresh` reloads the grid after an add.
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'character' | 'asset'>('character')
  const [listTab, setListTab] = useState<'characters' | 'assets' | 'notes'>('characters')
  const [assetRefresh, setAssetRefresh] = useState(0)
  // When the picked scene is outside the project, the create flow pauses on this
  // modal to ask whether to copy the scene into the character folder.
  const [copyPrompt, setCopyPrompt] = useState(false)
  // The scenes folder for a new character is editable (default from Settings);
  // the subfolder is the optional nested path inside it (empty = the base root).
  const [copyBase, setCopyBase] = useState(project.dazSubdir)
  const [copySubfolder, setCopySubfolder] = useState('')
  const [copyDeleteOriginal, setCopyDeleteOriginal] = useState(false)

  // Overview view / sort (persisted) + transient Genesis & Gender filters.
  const [view, setView] = usePersistentState<ViewMode>('dth.characters.view', 'grid')
  const [sort, setSort] = usePersistentState<SortKey>('dth.characters.sort', 'alpha')
  const [genesisFilter, setGenesisFilter] = useState('')
  const [genderFilter, setGenderFilter] = useState('')
  const sel = useSelection()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // Whether any character about to be deleted has a Houdini subfolder on disk —
  // gates the bulk-delete dialog's "keep Houdini files" toggle.
  const [keepHoudiniAvailable, setKeepHoudiniAvailable] = useState(false)

  /** Filename without extension, e.g. "X:\…\Kira.duf" → "Kira". */
  function sceneBaseName(p: string): string {
    return (p.replace(/[\\/]+$/g, '').split(/[\\/]/).pop() ?? '').replace(/\.duf$/i, '')
  }

  /**
   * Guess the generation from a scene filename ("LaraCroft_G8_1_GP" → G8.1,
   * "KiraG9" → G9, "Vicky Genesis 8" → G8). Longest match first so 8.1 isn't
   * swallowed by 8; null when the name gives no (supported) hint — G3 is not
   * selectable yet, so it is deliberately not guessed.
   */
  function genesisFromFileName(base: string): GenesisVersion | null {
    // Split CamelCase / digit→Upper seams into word boundaries first, so
    // "KiraG9" and "Genesis9Base" hint while "Aug8Party" doesn't.
    const s = base
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/([0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
    if (/(^|_)(g8_?1|genesis_?8_?1)(_|$)/.test(s)) return 'G8.1'
    if (/(^|_)(g8|genesis_?8)(_|$)/.test(s)) return 'G8'
    if (/(^|_)(g9|genesis_?9)(_|$)/.test(s)) return 'G9'
    return null
  }

  // The character's folder (and its JSON filename) are created from the name, so
  // disallow a trailing ".json".
  const nameTrimmed = name.trim()
  const nameError = /\.json$/i.test(nameTrimmed) ? 'A character name can’t end in “.json”.' : ''
  const canCreate = Boolean(nameTrimmed) && !nameError
  // ROM-prefill candidates: characters from every project that match the chosen
  // G + gender (filtered for ROM compatibility; labelled with their project).
  const prefillChars = (allCharacters ?? []).filter(
    (c) => c.genesis === genesis && c.gender === gender,
  )

  // First open of the prefill picker kicks off the cross-project fetch; later
  // opens reuse the loaded list (a failed fetch just leaves the picker empty).
  function loadPrefillCandidates() {
    if (allCharacters !== null || prefillLoading) return
    setPrefillLoading(true)
    fetchAllCharacters()
      .then(setAllCharacters)
      .catch(() => setAllCharacters([]))
      .finally(() => setPrefillLoading(false))
  }

  function applyScene(picked: string) {
    setScenePath(picked)
    // Prefill the name from the scene's filename (the folder is created from it).
    setName(sceneBaseName(picked))
    // Best-effort: when the filename hints the generation (Kira_G8_1.duf,
    // LaraG9.duf, "… Genesis 8 …"), preselect it — the user can still override.
    const hinted = genesisFromFileName(sceneBaseName(picked))
    if (hinted) {
      setGenesis(hinted)
      setPrefill('empty')
    }
  }

  async function onPickScene() {
    const picked = await pickDufPath('Select the Daz character scene (.duf)')
    if (picked) applyScene(picked)
  }

  // Open the create panel fresh — the "Add character" button.
  function openCreatePanel() {
    setError('')
    setScenePath('')
    setName('')
    setPrefill('empty')
    setPanelTab('character')
    setPanelOpen(true)
  }

  // Open the create panel straight on its Asset tab — the Assets grid's "Add".
  function openAssetPanel() {
    setError('')
    setPanelTab('asset')
    setPanelOpen(true)
  }

  // A Daz scene dropped anywhere on the page opens the panel, prefilled.
  function onDropScene(paths: Array<string>) {
    const dropped = paths[0]
    if (!dropped) return
    applyScene(dropped)
    setPanelTab('character')
    setPanelOpen(true)
  }

  // The whole page is a .duf drop target — `data-filedrop-id` goes on <main>.
  const { id: dropId, isOver: dropOver } = useFileDrop({ accept: ['duf'], onDrop: onDropScene })

  /** Is the picked scene located inside the project folder? */
  function sceneInsideProject(): boolean {
    const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
    return norm(scenePath).startsWith(norm(project.path) + '/')
  }

  async function onCreate() {
    if (!scenePath.trim() || !canCreate) return
    // Scene outside the project → ask whether to copy it into the character folder.
    if (!sceneInsideProject()) {
      setCopyBase(project.dazSubdir)
      setCopySubfolder('')
      setCopyDeleteOriginal(false)
      setCopyPrompt(true)
      return
    }
    await doCreate(false)
  }

  /** Create the character; when `copyScene`, also copy the scene + its thumbnails. */
  async function doCreate(copyScene: boolean) {
    // ROM prefill is 'empty', or an existing character's id to copy.
    const fromChar = prefill !== 'empty'
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
      setPanelOpen(false)
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

  // Filter options come from the values actually present, so a single-Genesis (or
  // single-gender) project shows no redundant filter. Sort runs after filtering.
  const genesisValues = [...new Set(characters.map((c) => c.genesis))].sort()
  const genderValues = [...new Set(characters.map((c) => c.gender))].sort()
  const visible = sortItems(
    characters.filter(
      (c) =>
        (!genesisFilter || c.genesis === genesisFilter) &&
        (!genderFilter || c.gender === genderFilter),
    ),
    sort,
    { name: (c) => c.name, date: (c) => c.updatedAt || c.createdAt || '' },
  )
  const selectedChars = visible.filter((c) => sel.isSelected(c.id))

  // When the confirm opens, check whether any selected character has a Houdini
  // subfolder on disk, so the dialog can offer to keep it (like the Daz folder).
  const selectedIds = selectedChars.map((c) => c.id).join(',')
  useEffect(() => {
    if (!confirmOpen) {
      setKeepHoudiniAvailable(false)
      return
    }
    const ids = selectedIds ? selectedIds.split(',') : []
    let cancelled = false
    void Promise.all(
      ids.map((id) =>
        characterKeepFolders({ data: { projectId, id } }).catch(() => ({ daz: false, houdini: false })),
      ),
    ).then((flags) => !cancelled && setKeepHoudiniAvailable(flags.some((f) => f.houdini)))
    return () => {
      cancelled = true
    }
  }, [confirmOpen, projectId, selectedIds])

  async function onBulkDelete({ keep, keep2 }: { keep: boolean; keep2: boolean }) {
    setDeleting(true)
    setDeleteError('')
    try {
      for (const character of selectedChars) {
        await deleteCharacter({
          data: { projectId, id: character.id, keepDaz: keep, keepHoudini: keep2 },
        })
      }
      const n = selectedChars.length
      sel.clear()
      setConfirmOpen(false)
      await router.invalidate()
      toast.success(`Deleted ${n} character${n === 1 ? '' : 's'}`)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <main data-filedrop-id={dropId} className="relative min-h-screen p-8 pb-24">
      {dropOver && (
        <div className="pointer-events-none fixed inset-4 z-[60] flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10 text-base font-medium text-primary">
          Drop a Daz scene (.duf) to create a character
        </div>
      )}
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <EditableTitle
            name={project.name}
            ariaLabel="Project name"
            onSave={async (next) => {
              await renameProject({ data: { projectId, name: next } })
              await router.invalidate()
              toast.success('Project renamed')
            }}
          />
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Tag>Project</Tag>
            <PathCode path={displayPath(project.path)} />
          </div>
        </div>
        <HeaderNav />
      </header>

      <SidePanel
        open={panelOpen}
        title={assetsEnabled && panelTab === 'asset' ? 'Add attachment' : 'Create character'}
        onClose={() => setPanelOpen(false)}
      >
        <Tabs
          value={assetsEnabled ? panelTab : 'character'}
          onValueChange={(v) => setPanelTab(v as 'character' | 'asset')}
          className="gap-6"
        >
          {assetsEnabled && (
            <TabsList className="w-full">
              <TabsTrigger value="character">Character</TabsTrigger>
              <TabsTrigger value="asset">Attachment</TabsTrigger>
            </TabsList>
          )}
          <TabsContent value="character">
            <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Choose its Daz scene (.duf) — or drop one anywhere on the page.
          <br />
          <strong className="font-semibold text-foreground">
            It must not contain an existing animation — only the character itself.
          </strong>
        </p>
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
                {/* Row 1: character name on its own line. */}
                <Field label="Character name" error={nameError}>
                  {/* The folder is created from the name, so it carries the
                      project-path prefix. */}
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 shrink-0 items-center rounded-md border bg-muted px-2.5 font-mono text-xs text-muted-foreground">
                      {displayPath('/project/')}
                    </span>
                    <Input
                      className="min-w-0 flex-1"
                      placeholder="Aria_G9"
                      value={name}
                      aria-invalid={nameError ? true : undefined}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && onCreate()}
                    />
                  </div>
                </Field>

                {/* Row 2: Genesis, Gender and ROM prefill together. */}
                <div className="flex flex-wrap items-start gap-3">
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
                        <SelectItem value="G8.1">G8.1</SelectItem>
                        <SelectItem value="G8">G8</SelectItem>
                        <SelectItem value="G3" disabled>
                          G3 — later
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
                  <Field
                    label={
                      <span className="flex items-center gap-1">
                        ROM prefill
                        {/* -my-1.5 keeps the 24px "i" from inflating the label line,
                            so this control stays bottom-aligned with Genesis/Gender. */}
                        <InfoPopup label="ROM prefill — more information" className="-my-1.5">
                          Copy the ROM definitions from an existing {genesis} {gender} character
                          in any project.
                        </InfoPopup>
                      </span>
                    }
                    className="min-w-[12rem] flex-1"
                  >
                    <Select
                      value={prefill}
                      onValueChange={setPrefill}
                      onOpenChange={(isOpen) => isOpen && loadPrefillCandidates()}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="empty">Empty</SelectItem>
                        {prefillLoading && (
                          <SelectItem value="__loading" disabled>
                            Loading characters…
                          </SelectItem>
                        )}
                        {prefillChars.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.projectName} - {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
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
          </TabsContent>
          {assetsEnabled && (
            <TabsContent value="asset">
              <AssetForm
                projectId={projectId}
                onCreated={() => {
                  setPanelOpen(false)
                  setAssetRefresh((k) => k + 1)
                  setListTab('assets')
                }}
              />
            </TabsContent>
          )}
        </Tabs>
      </SidePanel>

      {/* Linked Unreal projects: a footer bar docked to the bottom of the
          viewport, always visible (the loader revalidates on link/unlink, so
          loader data is the single source). The main element carries pb-20 so
          content scrolls clear of the bar. */}
      <UnrealProjectsBar project={project} onChanged={() => {}} />

      <Tabs
        value={!assetsEnabled && listTab === 'assets' ? 'characters' : listTab}
        onValueChange={(v) => setListTab(v as 'characters' | 'assets' | 'notes')}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="characters">Characters</TabsTrigger>
          {assetsEnabled && <TabsTrigger value="assets">Attachments</TabsTrigger>}
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
        <TabsContent value="notes">
          {/* Freeform project notes (markdown + dropped media). */}
          <NotesEditor projectId={projectId} />
        </TabsContent>
        <TabsContent value="characters">
          {characters.length === 0 ? (
            <div className="flex flex-col items-start gap-4">
              <p className="text-muted-foreground">
                No characters yet — drop a Daz scene anywhere, or add one.
              </p>
              <Button onClick={openCreatePanel}>
                <UserPlus /> Add character
              </Button>
            </div>
          ) : (
            <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={openCreatePanel}>
                <UserPlus /> Add
              </Button>
              <span className="text-sm text-muted-foreground">
                {visible.length === characters.length
                  ? `${characters.length} character${characters.length === 1 ? '' : 's'}`
                  : `${visible.length} of ${characters.length}`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                label="Genesis"
                value={genesisFilter}
                options={genesisValues}
                onChange={setGenesisFilter}
              />
              <FilterSelect
                label="genders"
                value={genderFilter}
                options={genderValues}
                onChange={setGenderFilter}
                renderOption={(g) => g.charAt(0).toUpperCase() + g.slice(1)}
              />
              <SortSelect value={sort} onChange={setSort} />
              <ViewToggle value={view} onChange={setView} />
            </div>
          </div>
          {visible.length === 0 ? (
            <p className="text-muted-foreground">No characters match the current filters.</p>
          ) : (
            <ul
              className={
                view === 'grid'
                  ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
                  : 'divide-y rounded-lg border bg-card'
              }
            >
              {visible.map((character) => {
                const skinning = characterSkinning(character).toUpperCase()
                const frames = countPoses(character.sections)
                const updated = formatDate(character.updatedAt || character.createdAt || '')
                return (
                  <li
                    key={character.id}
                    className={cn(
                      'group relative transition-colors hover:border-primary',
                      view === 'grid'
                        ? 'overflow-hidden rounded-lg border bg-card'
                        : 'flex items-center first:rounded-t-lg last:rounded-b-lg hover:bg-muted/40',
                    )}
                  >
                    <Link
                      to="/projects/$projectId/characters/$characterId"
                      params={{ projectId, characterId: character.id }}
                      onClick={(e) => {
                        // In selection mode a click toggles instead of navigating.
                        if (sel.selecting) {
                          e.preventDefault()
                          sel.toggle(character.id)
                        }
                      }}
                      className={cn(
                        'flex items-center',
                        view === 'grid' ? 'gap-4 p-4 pr-12' : 'min-w-0 flex-1 gap-3 px-3 py-2',
                      )}
                    >
                      <Portrait
                        image={character.image}
                        name={character.name}
                        className={cn(
                          'aspect-[3/4] shrink-0 rounded-md',
                          view === 'grid' ? 'w-16' : 'w-8',
                        )}
                        fallbackClassName={view === 'grid' ? 'text-2xl' : 'text-xs'}
                      />
                      {view === 'grid' ? (
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{character.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {character.genesis} · {skinning} · {frames} custom frames
                          </div>
                        </div>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {character.name}
                          </span>
                          <div className="hidden shrink-0 items-center gap-x-5 text-xs text-muted-foreground sm:flex">
                            <span className="w-10">{character.genesis}</span>
                            <span className="hidden w-14 capitalize md:inline">
                              {character.gender}
                            </span>
                            <span className="w-14">{skinning}</span>
                            <span className="w-20">{frames} frames</span>
                            {updated && (
                              <span className="hidden w-24 text-right xl:inline">{updated}</span>
                            )}
                          </div>
                        </>
                      )}
                    </Link>
                    <SelectCheckbox
                      checked={sel.isSelected(character.id)}
                      selecting={sel.selecting}
                      onChange={() => sel.toggle(character.id)}
                      className={cn(view === 'grid' ? 'absolute right-3 top-3' : 'mr-3 shrink-0')}
                    />
                  </li>
                )
              })}
            </ul>
              )}
            </>
          )}
        </TabsContent>
        {assetsEnabled && (
          <TabsContent value="assets">
            <AssetsGrid projectId={projectId} refreshKey={assetRefresh} onAdd={openAssetPanel} />
          </TabsContent>
        )}
      </Tabs>

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

      <SelectionBar
        // The Unreal footer bar docks at bottom-0 on this page — float the pill
        // above it instead of on top of it.
        className="bottom-20"
        open={sel.selecting}
        count={sel.count}
        total={visible.length}
        noun="character"
        onSelectAll={() => sel.selectAll(visible.map((c) => c.id))}
        onClear={sel.clear}
        onDelete={() => setConfirmOpen(true)}
        busy={deleting}
      />

      {confirmOpen && (
        <BulkDeleteDialog
          noun="character"
          names={selectedChars.map((c) => c.name)}
          message="This removes the character folder and its generated files. This cannot be undone."
          keepLabel={
            <>
              Keep the Daz files folder{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{project.dazSubdir}</code>
            </>
          }
          keep2Label={
            keepHoudiniAvailable ? (
              <>
                Keep the Houdini files folder{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{project.houdiniSubdir}</code>
              </>
            ) : undefined
          }
          busy={deleting}
          error={deleteError}
          onConfirm={onBulkDelete}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </main>
  )
}
