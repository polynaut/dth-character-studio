import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { FolderOpen, PaintBucket, UserPlus, X } from 'lucide-react'

import { Button, EditableTitle, Field, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SidePanel, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Tag, cn } from '@dth/ui'
import { Portrait } from '#/components/portrait.tsx'
import { ScenePreview } from '#/components/scene-preview.tsx'
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
  FillFromCharacterDialog,
  type FillExtra,
} from '#/components/character/fill-from-character-dialog.tsx'
import {
  characterKeepFolders,
  copyDazScene,
  createCharacter,
  deleteCharacter,
  fetchCharactersWithProblems,
  fetchProject,
  generateCharacterFiles,
  renameProject,
  saveCharacter,
  sceneWearables,
  setActiveProjectDir,
} from '#/lib/rom/api.ts'
import { pickDufPath } from '#/lib/desktop.ts'
import { useFileDrop } from '#/lib/file-drop.ts'
import { PRIMARY_SCENE_SUBFOLDER } from '#/lib/scene-subfolder.ts'
import { browseStart, displayPath, normalizePathLower, stripTrailingSeparators } from '#/lib/path.ts'
import { PathCode, tallPathChipClass } from '#/components/path-code.tsx'
import { HeaderNav } from '#/components/header-nav.tsx'
import { SceneValidationTable } from '#/components/scene-compat.tsx'
import { UnrealProjectsBar } from '#/components/unreal-projects-field.tsx'
import { NotesEditor } from '#/components/notes-editor.tsx'
import { ProjectOperations } from '#/components/project-operations.tsx'
import {
  charactersLinkedScenes,
  genderForScan,
  sceneCompatFailed,
  sceneCompatHardFailed,
  sceneCreateRows,
  sceneNotLinkedRow,
} from '#/lib/scene-compat.ts'

import { characterSkinning, countPoses, defaultSections, genesisFromFigureNode } from '@dth/rom'

import type { SceneWearables } from '#/lib/rom/api.ts'
import type { Gender, GenesisVersion, RomSection } from '@dth/rom'

export const Route = createFileRoute('/projects/$projectId/')({
  loader: async ({ params, preload }) => {
    // The route param IS the project's folder path. Pin it as the active project so
    // avatars (in its `.dcsmeta`) resolve for this window — but NOT on a hover
    // preload, which would repoint window-global avatar resolution for a
    // navigation that may never happen.
    if (!preload) setActiveProjectDir(params.projectId)
    const project = await fetchProject({ data: { projectId: params.projectId } })
    if (!project) throw notFound()
    // Deliberately NOT fetching the cross-project prefill candidates here: that
    // walks EVERY recent project's library, and one cold network share would
    // stall this whole page. They load lazily when the prefill picker opens.
    // One walk returns the characters AND the scan problems (torn writes,
    // too-new schemas) — a problem file must warn here, not silently render
    // as a missing character.
    const { characters, problems } = await fetchCharactersWithProblems({
      data: { projectId: params.projectId },
    })
    return { project, characters, scanProblems: problems }
  },
  component: ProjectCharactersPage,
})

function ProjectCharactersPage() {
  const { projectId } = Route.useParams()
  const { project, characters, scanProblems } = Route.useLoaderData()
  // The reusable Daz-scene "assets" feature is opt-in per project (its manifest).
  // Off → the project shows characters only (no Assets tab).
  const assetsEnabled = project.assetsEnabled
  const router = useRouter()
  const [scenePath, setScenePath] = useState('')
  const [name, setName] = useState('')
  const [genesis, setGenesis] = useState<GenesisVersion>('G9')
  const [gender, setGender] = useState<Gender>('female')
  // ROM prefill staged by the Fill wizard (null = start empty): the source
  // character, the sections picked from it and the "Also copy" extras —
  // createCharacter applies them.
  const [prefill, setPrefill] = useState<{
    fromId: string
    fromName: string
    sections: Array<RomSection>
    extras: Record<FillExtra, boolean>
  } | null>(null)
  const [fillOpen, setFillOpen] = useState(false)
  // The wizard's target while creating: the picked genesis/gender over the
  // stock defaults — no character id exists yet, so nothing is excluded.
  const fillTarget = useMemo(
    () => ({ id: '', genesis, gender, sections: defaultSections() }),
    [genesis, gender],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Bumped on every scene pick so a slow scan of an earlier scene can't clobber
  // the Genesis/gender the latest pick auto-selected (see `applyScene`).
  const sceneScanId = useRef(0)
  // The picked scene's read: feeds the create Validation rows (one character,
  // empty timeline), the Genesis auto-select and the DERIVED gender (figure id
  // / GP-DK geograft — there is no manual Gender field anymore). null while
  // the read is in flight; `createForce` is the "Create anyway" escape.
  const [sceneScan, setSceneScan] = useState<SceneWearables | null>(null)
  const [createForce, setCreateForce] = useState(false)
  // The create-character form lives in a slide-in side panel now. The panel and the
  // listing each carry a tab — "characters" (the existing flow) vs "assets" (reusable
  // Daz scenes scoped to this project). `assetRefresh` reloads the grid after an add.
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<'character' | 'asset'>('character')
  const [listTab, setListTab] = useState<'characters' | 'assets' | 'notes' | 'operations'>(
    'characters',
  )
  const [assetRefresh, setAssetRefresh] = useState(0)
  // "Delete original after copying" for an outside-the-project scene — the
  // panel's toggle beside Copy & Create (turns the copy into a move). The old
  // intermediate copy modal is Add-scene-only now; creating never detours.
  const [deleteOriginal, setDeleteOriginal] = useState(false)

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
    return (stripTrailingSeparators(p).split(/[\\/]/).pop() ?? '').replace(/\.duf$/i, '')
  }

  // The character's folder (and its JSON filename) are created from the name, so
  // disallow a trailing ".json".
  const nameTrimmed = name.trim()
  const nameError = /\.json$/i.test(nameTrimmed) ? 'A character name can’t end in “.json”.' : ''
  const canCreate = Boolean(nameTrimmed) && !nameError
  // Create-dialog validation (see lib/scene-compat.ts): the checks that need no
  // existing character — one character in the scene, empty timeline. A definite
  // fail (or the read still in flight) gates Create behind "Create anyway".
  const createRows = [
    ...sceneCreateRows(scenePath.trim() ? sceneScan : null),
    // The picked scene must not already belong to a character of this project —
    // a HARD fail with no "Create anyway" escape. The loader's character list
    // is always at hand here.
    ...(scenePath.trim()
      ? [sceneNotLinkedRow(scenePath.trim(), charactersLinkedScenes(characters))]
      : []),
  ]
  const createChecking = scenePath.trim() !== '' && sceneScan === null
  const createHardBlocked = sceneCompatHardFailed(createRows)
  const createBlocked =
    createChecking || createHardBlocked || (sceneCompatFailed(createRows) && !createForce)
  const createBlockedTitle = createChecking
    ? 'Checking the scene…'
    : createHardBlocked
      ? 'This scene already belongs to a character — pick a different scene'
      : 'A validation check failed — see the list above (or flip “Create anyway”)'
  // What the Gender row DISPLAYS: only what the picked scene proves (null =
  // no scene / scan pending / undecidable → "Unknown"). The `gender` state
  // keeps its best-effort value for the create input regardless.
  const detectedGender = scenePath.trim() && sceneScan ? genderForScan(sceneScan) : null
  function applyScene(picked: string) {
    setScenePath(picked)
    // Prefill the name from the scene's filename (the folder is created from it).
    setName(sceneBaseName(picked))
    setSceneScan(null)
    setCreateForce(false)
    // A new scene can change the detected genesis/gender — a staged ROM
    // prefill from the previous identity would no longer be compatible.
    setPrefill(null)
    // Read what's actually IN the scene: the Validation rows, the Genesis
    // auto-select (the figure node's id — still user-editable) and the DERIVED
    // gender (figure id for the gendered generations, GP/DK geograft for the
    // neutral G9 — `genderForScan`). Best-effort and async — outside the
    // desktop app the current values stand. `createCharacter` re-derives the
    // scene-driven fields authoritatively; setting them here keeps the prefill
    // filter and the create input in step with what will be created.
    const scanId = (sceneScanId.current += 1)
    void sceneWearables({ data: { scenePath: picked } }).then((scan) => {
      // Drop a scan the user has already superseded by picking another scene.
      if (scanId !== sceneScanId.current) return
      setSceneScan(scan)
      const figure = scan.figures[0] ?? null
      const detected = figure ? genesisFromFigureNode(figure.id) : null
      if (detected) setGenesis(detected.genesis)
      const derivedGender = genderForScan(scan)
      if (derivedGender) setGender(derivedGender)
    })
  }

  async function onPickScene() {
    // Re-picking opens at the scene already chosen; a first pick starts in the
    // project folder (`projectId` IS its path), which is where the character —
    // and usually its scene — is about to live.
    const picked = await pickDufPath(
      'Select the Daz character scene (.duf)',
      browseStart(scenePath, projectId),
    )
    if (picked) applyScene(picked)
  }

  // Open the create panel fresh — the "Add character" button.
  function openCreatePanel() {
    setError('')
    setScenePath('')
    setName('')
    setPrefill(null)
    setSceneScan(null)
    setCreateForce(false)
    setDeleteOriginal(false)
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
    return normalizePathLower(scenePath).startsWith(normalizePathLower(project.path) + '/')
  }
  // An outside scene gets the two-action footer (Link & Create / Copy & Create)
  // + the delete-original toggle; an in-project scene just creates.
  const sceneOutside = scenePath.trim() !== '' && !sceneInsideProject()

  async function onCreate(copyScene = sceneOutside) {
    // Guard `busy` too: the buttons are disabled while creating, but the
    // Enter-key handler isn't, so a fast double-Enter could race two creates.
    // `createBlocked` guards the Enter path against failed/running validation.
    // Enter defaults to the primary action: copy an outside scene in.
    // No scene picked is a VALID create (scene-less character — the folder is
    // seeded and the editor stays locked until the primary scene is linked).
    if (busy || !canCreate || createBlocked) return
    await doCreate(copyScene)
  }

  /** Create the character; when `copyScene`, also copy the scene + its thumbnails. */
  async function doCreate(copyScene: boolean) {
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
          prefillFromId: prefill?.fromId,
          prefillSections: prefill?.sections,
          prefillExtras: prefill?.extras,
        },
      })
      if (copyScene) {
        // Copying brings the scene into the character folder — repoint the
        // stored scenePath at that in-project copy (createCharacter recorded the
        // original external path). The primary always lands in its own
        // "primary" subfolder below the project's scenes folder (Settings →
        // dazSubdir) — its export nests under that name (lib/scene-subfolder.ts).
        const movedScene = await copyDazScene({
          data: {
            projectId,
            characterId: character.id,
            scenePath: scenePath.trim(),
            subfolder: [
              ...project.dazSubdir.split(/[\\/]+/).filter(Boolean),
              PRIMARY_SCENE_SUBFOLDER,
            ].join('/'),
            deleteOriginal,
          },
        })
        // Repoint the per-scene records too (the pre-selected hair rides on the
        // scene path) — the original path just stopped being a linked scene.
        character = await saveCharacter({
          data: {
            projectId,
            character: {
              ...character,
              scenePath: movedScene,
              sceneOverrides: character.sceneOverrides.map((o) =>
                o.scenePath === scenePath.trim() ? { ...o, scenePath: movedScene } : o,
              ),
            },
          },
        })
      }
      // Generate the initial files so they exist + match the UI right away — the
      // editor's Save starts disabled (nothing dirty), so it wouldn't otherwise.
      try {
        await generateCharacterFiles({ data: { projectId, id: character.id } })
      } catch {
        // Non-fatal — the editor's Save can regenerate.
      }
      setScenePath('')
      setName('')
      setPrefill(null)
      setSceneScan(null)
      setCreateForce(false)
      setPanelOpen(false)
      await router.invalidate()
      toast.success(`Created “${character.name}”`)
      await router.navigate({
        to: '/projects/$projectId/characters/$characterId',
        params: { projectId, characterId: character.id },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // A copy/save failure lands AFTER createCharacter succeeded — the character
      // already exists on disk. Refresh the list so it isn't invisible (and a
      // retry doesn't re-run createCharacter against the leftover folder).
      void router.invalidate()
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
      toast.success(`Deleted ${n} character${n === 1 ? '' : 's'}`)
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    } finally {
      // Always refresh: on a mid-loop failure the ALREADY-deleted characters must
      // not linger in the list (clicking one 404s; a retry would re-delete them).
      void router.invalidate()
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
        {/* The old bold "no animation" warning is gone — the live Validation
            table below now checks exactly that (and "one character"). */}
        <p className="text-sm text-muted-foreground">
          Choose its Daz scene (.duf) — or drop one anywhere on the page. No scene yet? Create
          the character without one: its folder is set up for you to save the scene into.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="shrink-0"
            onClick={() => void onPickScene()}
          >
            <FolderOpen /> {scenePath.trim() ? 'Choose another…' : 'Choose Daz scene…'}
          </Button>
          {scenePath.trim() && (
            // Path chip (taller, to match the button height) for the picked scene.
            <PathCode path={displayPath(scenePath)} className={tallPathChipClass} />
          )}
        </div>

        {/* The form renders with OR without a picked scene — a scene-less create
            seeds the character folder (the user saves their scene into it later
            and links it on the character page, which stays locked until then). */}
        <>
            <div className="flex flex-wrap items-start gap-4">
              {/* The DERIVED gender rides on the preview as a badge (tooltip =
                  the text): the figure id for gendered generations, the GP/DK
                  geograft for G9 — see `genderForScan`. Read-only, and only as
                  far as the SCENE proves it — undecided shows "?". */}
              {scenePath.trim() !== '' && (
              <ScenePreview
                scenePath={scenePath}
                badge={
                  <span
                    className="absolute bottom-1.5 left-1.5 flex size-6 cursor-default items-center justify-center rounded-full border bg-background/85 text-sm font-semibold"
                    title={
                      detectedGender === 'female'
                        ? 'Female — read from the scene (its figure / GP-DK geograft)'
                        : detectedGender === 'male'
                          ? 'Male — read from the scene (its figure / GP-DK geograft)'
                          : 'Unknown — the scene doesn’t tell (no gendered figure or GP/DK geograft)'
                    }
                  >
                    {detectedGender === 'female' ? '♀' : detectedGender === 'male' ? '♂' : '?'}
                  </span>
                }
              />
              )}
              <div className="min-w-[20rem] flex-1 space-y-4">
                {/* Row 1: character name on its own line. */}
                {/* The Input is wrapped in a div (path prefix + input), so Field's
                    automatic label wiring can't reach it — controlId points the
                    label (and the error line's id) at the Input explicitly. */}
                <Field
                  label="Character name"
                  // Only pass a REAL error: Field's '' reservation keeps a
                  // 20px empty line under the input, breaking this panel's
                  // uniform space-y rhythm between the three rows. The small
                  // shift when an error appears is fine here.
                  error={nameError || undefined}
                  controlId="create-character-name"
                >
                  {/* The folder is created from the name, so it carries the
                      project-path prefix. */}
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 shrink-0 items-center rounded-md border bg-muted px-2.5 font-mono text-xs text-muted-foreground">
                      {displayPath('/project/')}
                    </span>
                    <Input
                      id="create-character-name"
                      // Field renders the error line as `${controlId}-error`
                      // (present only while invalid — see the error prop above).
                      aria-describedby={nameError ? 'create-character-name-error' : undefined}
                      className="min-w-0 flex-1"
                      placeholder="Aria_G9"
                      value={name}
                      aria-invalid={nameError ? true : undefined}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void onCreate()
                      }}
                    />
                  </div>
                </Field>

                {/* Row 2: Genesis and the ROM-prefill Fill button. */}
                <div className="flex flex-wrap items-start gap-3">
                  {/* Radix Select.Root renders no DOM and drops `id` — the label
                      wires to the trigger button via controlId (same below). */}
                  <Field label="Genesis" className="shrink-0" controlId="create-genesis">
                    <Select
                      value={genesis}
                      onValueChange={(v) => {
                        setGenesis(v as GenesisVersion)
                        setPrefill(null)
                      }}
                    >
                      <SelectTrigger id="create-genesis" className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="G9">G9</SelectItem>
                        <SelectItem value="G8.1">G8.1</SelectItem>
                        <SelectItem value="G8">G8</SelectItem>
                        <SelectItem value="G3">G3</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {/* The ROM prefill: just the Fill-wizard button (self-explanatory
                      once its dialog opens — no label/info/empty-state). `self-end`
                      bottom-aligns it with the labelled Genesis select; a staged
                      fill shows beside it with a reset. */}
                  <div className="flex h-9 min-w-0 items-center gap-2 self-end">
                    {/* Default size (h-9) — same height as the Genesis select. */}
                    <Button variant="outline" onClick={() => setFillOpen(true)}>
                      <PaintBucket /> Fill from character
                    </Button>
                    {prefill && (
                      <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
                        <span className="truncate">
                          {prefill.sections.length} section
                          {prefill.sections.length === 1 ? '' : 's'}
                          {(() => {
                            const n = Object.values(prefill.extras).filter(Boolean).length
                            return n > 0 ? ` + ${n} extra${n === 1 ? '' : 's'}` : ''
                          })()}{' '}
                          from “{prefill.fromName}”
                        </span>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Reset the ROM prefill"
                          onClick={() => setPrefill(null)}
                        >
                          <X />
                        </Button>
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 3 (outside-the-project scene only): Copy & Create copies
                    the scene into the character's folder — this turns the copy
                    into a move. Linking instead is the outline footer action. */}
                {sceneOutside && (
                  <label
                    className="flex h-9 w-fit items-center gap-2 text-sm"
                    title="Copy & Create copies the picked scene into the character's folder — turn this on to move it instead"
                  >
                    <Switch checked={deleteOriginal} onCheckedChange={setDeleteOriginal} />
                    Delete original after copying
                  </label>
                )}
              </div>
            </div>

            {scenePath.trim() !== '' && (
              <SceneValidationTable
                rows={createRows}
                loading={createChecking}
                force={createForce}
                onForceChange={setCreateForce}
                forceLabel="Create anyway — a failed check usually means a broken ROM"
                projectId={projectId}
              />
            )}

            {scenePath.trim() === '' && (
              <p className="text-sm text-muted-foreground">
                Without a scene the character starts locked: save your Daz scene into its{' '}
                <code>{`${project.dazSubdir || 'daz3d'}/${PRIMARY_SCENE_SUBFOLDER}`}</code> folder,
                then link it on the character page to unlock the editor.
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            {/* An outside scene offers both actions — Copy & Create primary,
                Link & Create beside it. An in-project scene has nothing to
                copy: one plain Create. No intermediate modal either way. */}
            <div className="flex justify-end gap-2">
              {sceneOutside && (
                <Button
                  variant="outline"
                  onClick={() => void onCreate(false)}
                  disabled={busy || !canCreate || createBlocked || deleteOriginal}
                  title={
                    createBlocked
                      ? createBlockedTitle
                      : deleteOriginal
                        ? 'Disabled while “Delete original” is on'
                        : 'Keep the scene where it is — the character links to it'
                  }
                >
                  <UserPlus /> Link & Create
                </Button>
              )}
              <Button
                onClick={() => void onCreate()}
                disabled={busy || !canCreate || createBlocked}
                title={
                  createBlocked
                    ? createBlockedTitle
                    : sceneOutside
                      ? 'Copy the scene into the character’s folder, then create'
                      : undefined
                }
              >
                <UserPlus />{' '}
                {busy
                  ? sceneOutside
                    ? deleteOriginal
                      ? 'Moving…'
                      : 'Copying…'
                    : 'Creating…'
                  : sceneOutside
                    ? 'Copy & Create'
                    : scenePath.trim()
                      ? 'Create'
                      : 'Create without scene'}
              </Button>
            </div>
          </>
            </div>
          </TabsContent>
          {assetsEnabled && (
            <TabsContent value="asset">
              <AssetForm
                projectId={projectId}
                // The panel's ONE scene selection, shared with the Character tab
                // — a pick here re-runs the character derivation (name, scan,
                // genesis/gender) so switching back shows the same scene.
                scenePath={scenePath.trim()}
                onScenePathChange={applyScene}
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
      <UnrealProjectsBar project={project} />

      <Tabs
        value={!assetsEnabled && listTab === 'assets' ? 'characters' : listTab}
        onValueChange={(v) => setListTab(v as 'characters' | 'assets' | 'notes' | 'operations')}
      >
        <TabsList className="mb-6">
          <TabsTrigger value="characters">Characters</TabsTrigger>
          {assetsEnabled && <TabsTrigger value="assets">Attachments</TabsTrigger>}
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="operations">Operations</TabsTrigger>
        </TabsList>
        <TabsContent value="notes">
          {/* Freeform project notes (markdown + dropped media). */}
          <NotesEditor projectId={projectId} />
        </TabsContent>
        <TabsContent value="operations">
          {/* Project-level danger zone (delete the whole project). */}
          <ProjectOperations project={project} />
        </TabsContent>
        <TabsContent value="characters">
          {scanProblems.length > 0 && (
            <div
              role="alert"
              className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
            >
              <p className="font-medium">
                {scanProblems.length === 1
                  ? '1 character file could not be read and is not shown:'
                  : `${scanProblems.length} character files could not be read and are not shown:`}
              </p>
              <ul className="mt-1 space-y-0.5 text-muted-foreground">
                {scanProblems.map((p) => (
                  <li key={p.path}>
                    <PathCode path={displayPath(p.path)} /> — {p.reason}
                  </li>
                ))}
              </ul>
              {scanProblems.some((p) => p.tooNew) && (
                <p className="mt-2">
                  Saved by a newer build — update the app to open{' '}
                  {scanProblems.filter((p) => p.tooNew).length === 1 ? 'it' : 'them'}, or{' '}
                  <Link
                    to="/tools"
                    search={{ tab: 'refresh' }}
                    className="font-medium text-primary underline underline-offset-2"
                  >
                    Refresh assets
                  </Link>{' '}
                  can reset {scanProblems.filter((p) => p.tooNew).length === 1 ? 'it' : 'them'} to
                  this version (dropping the newer fields).
                </p>
              )}
            </div>
          )}
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
                        // Both views keep the portrait face-zoom; list view uses
                        // the landscape 13:9 crop (the ratio the character page's
                        // header settles into) and overrides the zoom's % lift
                        // with a fixed −14px so the face sits right at the top.
                        imgClassName={view === 'list' ? '-translate-y-[14px]' : undefined}
                        className={cn(
                          'shrink-0 rounded-md',
                          view === 'grid' ? 'aspect-[3/4] w-16' : 'aspect-[13/9] w-16',
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

      {fillOpen && (
        <FillFromCharacterDialog
          target={fillTarget}
          onFill={(_patch, source) =>
            setPrefill({
              fromId: source.id,
              fromName: source.name,
              sections: source.picked,
              extras: source.extras,
            })
          }
          onClose={() => setFillOpen(false)}
        />
      )}
      <SelectionBar
        // The Unreal footer bar docks at bottom-0 on this page and reserves
        // exactly 80px (min-h-[80px] in unreal-projects-field). bottom-20 is
        // that same 80px, so the pill sat flush on the footer's top edge —
        // clear it by the pill's own default bottom-6 gap: 80 + 24 = 104px.
        className="bottom-26"
        open={sel.selecting}
        // Visible∩selected — delete acts on `selectedChars`, so the pill must
        // not count selections hidden by the Genesis/gender filters.
        count={selectedChars.length}
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
          // Fire and forget on purpose: the dialog's `busy`/`error` props are
          // how progress and failure come back, so it never awaits this.
          onConfirm={(opts) => void onBulkDelete(opts)}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </main>
  )
}
