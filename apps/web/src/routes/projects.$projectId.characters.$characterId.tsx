import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import {
  ArrowLeft,
  CircleX,
  FolderOpen,
  Pencil,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'

import { Avatar } from '#/components/avatar.tsx'
import { Button, EditableTitle, InfoPopup, Label, NumberField, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Tabs, TabsList, TabsTrigger, useModifierHeld, useRefetchOnFocus } from '@dth/ui'
import { PathCode } from '#/components/path-code.tsx'
import { toast } from 'sonner'
import { RomSections } from '#/components/rom-sections.tsx'
import { RomTimeline } from '#/components/rom/rom-timeline.tsx'
import {
  characterKeepFolders,
  deleteCharacter,
  dismissRomRunLog,
  fetchCharacter,
  fetchPoseAssets,
  fetchProductScan,
  fetchProject,
  fetchMorphIndex,
  fetchRomRunLog,
  fetchSettings,
  fileExists,
  generateCharacterFiles,
  getCharacterPath,
  isDirectory,
  setActiveProjectDir,
  resolvePresetFrames,
  saveCharacter,
} from '#/lib/rom/api.ts'
import { BulkDeleteDialog } from '#/components/bulk-delete-dialog.tsx'
import { CharacterProductsTab } from '#/components/character-products-tab.tsx'
import { PreserveFields } from '#/components/character/preserve-fields.tsx'
import { RomRunLogReport } from '#/components/character/rom-run-log-report.tsx'
import { NotesEditor } from '#/components/notes-editor.tsx'
import { DazSceneField } from '#/components/daz-scene-field.tsx'
import { HoudiniProjectsField } from '#/components/houdini-projects-field.tsx'
import { ImageDialog } from '#/components/image-dialog.tsx'
import { StorageLocation } from '#/components/storage-location.tsx'
import { pickFolder } from '#/lib/desktop.ts'
import { studioCharScriptsDir } from '#/lib/rom/storage.ts'
import { useCharacterDraft } from '#/lib/use-character-draft.ts'
import { displayPath, normalizePath } from '#/lib/path.ts'
import {
  boneScaleRefPoses,
  characterSkinning,
  countPoses,
  presetFramesSignature,
  romTimeline,
} from '@dth/rom'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'
import type { PresetFrames, RomSection } from '@dth/rom'
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
    const [
      project,
      settings,
      catalog,
      location,
      sceneExists,
      sceneFolderExists,
      productScan,
      romRunLog,
    ] = await Promise.all([
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
      // The run log the ROM script writes in Daz — re-read on window focus too,
      // so problems show the moment the user switches back to the studio.
      fetchRomRunLog({ data: { projectId, id } }),
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
      romRunLog,
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
    romRunLog: initialRomRunLog,
  } = Route.useLoaderData()
  const router = useRouter()
  // A blocked-save validation error, sent to the ROM editor to open its section,
  // scroll the offending pose row in and focus its first empty field.
  const [revealPose, setRevealPose] = useState<{
    section: RomSection
    poseId: string
    nonce: number
  } | null>(null)
  // The draft + save/generate machinery (dirty vs baseline, unsaved-changes
  // guard, save → generate → settle in one paint) lives in the hook; the page
  // only wires a blocked save to the reveal signal above.
  const draft = useCharacterDraft({
    projectId,
    initial,
    onValidationErrors: (errors) => {
      const first = errors[0]
      setRevealPose((prev) => ({
        section: first.section,
        poseId: first.poseId,
        nonce: (prev?.nonce ?? 0) + 1,
      }))
    },
  })
  const { character, dirty, saving, patch } = draft
  // Preset ROM block lengths, re-measured from the .duf assets whenever the
  // preset/custom selections change (kept from the last good measure during a
  // re-measure; null only when an included asset can't be read).
  const [presetFrames, setPresetFrames] = useState<PresetFrames | null>(initialFrames)
  // Only meaningful when the project enables Daz Products: splits this page into a
  // "Character" tab (everything) and a "Products" tab (the scan section).
  const [activeTab, setActiveTab] = useState<'character' | 'products' | 'notes'>('character')
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  // The ROM run log written by the Daz-side script (ingested into the studio's
  // own store on read). Re-read whenever the window regains focus, so problems
  // from a run surface the moment the user switches back from Daz to the studio.
  const [romRunLog, setRomRunLog] = useState(initialRomRunLog)
  useRefetchOnFocus(() => {
    void fetchRomRunLog({ data: { projectId, id: initial.id } }).then(setRomRunLog)
  }, [projectId, initial.id])

  // The scanned morph index for this generation (Scan_Morphs_<Genesis>.dsa →
  // app-data JSON) powering the Morph-name autocomplete. Loaded on mount and
  // re-read on window focus, so a scan just run in Daz is offered immediately.
  const [morphIndex, setMorphIndex] = useState<Array<MorphIndexEntry>>([])
  useRefetchOnFocus(
    () => {
      void fetchMorphIndex(character.genesis).then(setMorphIndex)
    },
    [character.genesis],
    { immediate: true },
  )
  async function onDismissRomRunLog() {
    setRomRunLog(null)
    await dismissRomRunLog({ data: { projectId, id: initial.id } })
  }
  const hasRunProblems = !!romRunLog && !romRunLog.ok
  // Frames whose morphs failed in the last run — the matching editor rows go red.
  const failedFrames = hasRunProblems
    ? new Set(romRunLog.failedMorphs.map((morph) => morph.frame))
    : undefined
  // The "reveal frame N" signal a clicked failed morph sends to the ROM editor
  // (nonce forces the effect to re-fire even for the same frame).
  const [revealFrame, setRevealFrame] = useState<{ frame: number; nonce: number } | null>(null)
  // Clicking a failed morph in the report opens its ROM section and scrolls its
  // row into view (RomSections does the scroll off the nonce change).
  function revealFailedFrame(frame: number) {
    setRevealFrame((prev) => ({ frame, nonce: (prev?.nonce ?? 0) + 1 }))
  }
  const swallowNavRef = useRef(false)
  // Power-user: holding Ctrl force-enables Save so the JSON can be re-written to
  // disk even when nothing changed (handy during development).
  const ctrlHeld = useModifierHeld('Control')

  // Bone-scale frames need the exporter (an export dir) to produce their reference
  // FBX and resolve its CSV path — flag when some are set but no export dir is.
  // Which poses count is generation's call (boneScaleRefPoses), not re-derived here.
  const boneScaleFrames = boneScaleRefPoses(character.sections).length
  // Re-measure the preset ROM block lengths when a preset/custom selection that
  // affects them changes (not on every custom-pose keystroke). Debounced; the
  // last good value is kept until the new one lands, so frame numbers don't
  // flicker. Null only when an included asset can't be read. Which fields count
  // is owned by @dth/rom (next to the path resolution), not hand-mirrored here.
  const presetSignature = presetFramesSignature(character)
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
  // Where the generated ROM_<Name>_<Genesis>.dsa lands in the Daz library, so
  // the user knows where to find/run it in Daz. Empty until the DAZ library is set.
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
  // generation splits into the ROM_ build script + a standalone Export_ script
  // (see generate.ts toCharacterScriptDsa / toExportScriptDsa). Otherwise it's
  // one self-contained ROM_<Name>_<Genesis>.dsa. Drives the scripts-pane note.
  const exportSet = character.exportPath.trim() !== ''
  const exportSplit = exportSet && character.exportWithRomScript === false

  // Inline rename from the title — persists immediately (like the avatar) so the
  // new name + folder rename stick without needing the Save button.
  async function onRenameCharacter(next: string) {
    const previousName = character.name
    const updated = { ...character, name: next }
    patch({ name: next })
    const saved = await saveCharacter({ data: { projectId, character: updated } })
    draft.settle(saved)
    // Renaming moves the character folder + renames the generated script, so
    // regenerate at the new name and drop the old-named script in the shared folder.
    const result = await generateCharacterFiles({ data: { projectId, id: saved.id, previousName } })
    void router.invalidate()
    draft.notifyGenerated(`Renamed to “${next}”`, result)
  }

  // Linking a Daz scene persists immediately (see relinkScene), so settle the
  // draft + baseline on the saved result — like the inline rename / avatar.
  const onSceneLinked = draft.settle

  // A folder move can repoint the linked scene (it travels with the folder when
  // it lives inside it). Sync just the scene path into the draft + baseline so
  // the Daz scene field stays correct without discarding any unsaved edits.
  function onCharacterMoved(moved: Character) {
    draft.syncPersisted({ scenePath: moved.scenePath })
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

  // Guide the export-folder picker to where the export usually lands: re-choosing
  // starts at the current dir; a first pick opens in the character's folder —
  // already inside its Houdini subfolder when that subfolder exists on disk. The
  // user can still browse elsewhere; this is only where the dialog opens.
  async function defaultExportDir(): Promise<string | undefined> {
    if (character.exportPath.trim()) return character.exportPath
    const defAbs = location?.definitionAbs
    if (!defAbs) return undefined
    const charDir = normalizePath(defAbs).replace(/\/[^/]*$/, '')
    const houSub = project?.houdiniSubdir?.trim()
    if (houSub) {
      const houDir = `${charDir}/${houSub}`
      if (await isDirectory(houDir)) return houDir
    }
    return charDir
  }

  async function onPickExportDir() {
    const picked = await pickFolder(
      'Choose the export directory for the DTH Exporter',
      await defaultExportDir(),
    )
    if (picked) await draft.patchAndRegenerate({ exportPath: picked }, 'Export folder set — script regenerated')
  }

  async function onDeleteCharacter({ keep, keep2 }: { keep: boolean; keep2: boolean }) {
    setDeleting(true)
    setDeleteError('')
    try {
      await deleteCharacter({
        data: { projectId, id: character.id, keepDaz: keep, keepHoudini: keep2 },
      })
      toast.success(`Deleted “${character.name}”`)
      // Navigation unmounts this editor — no need to reset the busy flag. The
      // unsaved-changes guard is bypassed: the edited character no longer exists.
      draft.unsavedGuard.bypass()
      await router.navigate({ to: '/projects/$projectId', params: { projectId } })
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
      setDeleting(false)
    }
  }

  // When Daz Products is enabled the body splits into two tabs ("Character" /
  // "Products"). We keep both groups mounted and toggle visibility with `hidden`
  // rather than unmounting — cheaper, and it preserves scroll/edit state when
  // switching. Gate on the flag too: if the feature is disabled while the
  // Products tab is active, the character group must not stay hidden.
  const onProductsTab = !!project?.dazProductsEnabled && activeTab === 'products'

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
          className="flex items-center gap-1 text-sm text-muted-foreground! no-underline hover:text-foreground!"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
      </div>

      <header className="sticky top-0 z-10 mb-8 flex items-end gap-5 bg-background">
        {/* Back stays reachable while scrolled: the page's own Back link lives
            above this sticky header, so a second one fades in here (same
            scroll-timeline as the header collapse) once that one is gone. */}
        {/* top-5 matches the avatar's mt-5, so the link tops align. */}
        <div className="absolute top-5 left-[150px] z-20">
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            className="backlink-scroll flex items-center gap-1 text-sm text-muted-foreground! no-underline hover:text-foreground!"
          >
            <ArrowLeft className="size-4" /> Back
          </Link>
        </div>
        {/* Top-centered, its own standalone element. The full-width wrapper
            centers it via flexbox (robust regardless of the containing block);
            the button fades/slides in on scroll (scroll-timeline, same range as
            the subtitle collapse) so it's hidden at the top where the full report
            is already visible. Click scrolls back up to the report. */}
        {hasRunProblems && (
          <div className="pointer-events-none absolute inset-x-0 top-5 z-20 flex justify-center">
            <button
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              title="Scroll to the run report"
              className="runhint-scroll pointer-events-auto flex items-center gap-1.5 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-sm font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/20"
            >
              <CircleX className="size-4 shrink-0" />
              Errors in the last ROM run — click to see details
            </button>
          </div>
        )}
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
          <Button variant="outline" onClick={draft.discard} disabled={saving || !dirty}>
            <Undo2 /> Discard
          </Button>
          <Button
            onClick={() => void draft.save()}
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
      {/* Above the tabs, so the report is visible from the Products tab too. */}
      {romRunLog && !romRunLog.ok && (
        <RomRunLogReport
          romRunLog={romRunLog}
          onDismiss={() => void onDismissRomRunLog()}
          onRevealFrame={revealFailedFrame}
        />
      )}

      <Tabs
        value={activeTab}
        onValueChange={(v) =>
          setActiveTab(v === 'products' || v === 'notes' ? v : 'character')
        }
        className="mb-6"
      >
        <TabsList>
          <TabsTrigger value="character">Character</TabsTrigger>
          {project?.dazProductsEnabled && <TabsTrigger value="products">Products</TabsTrigger>}
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === 'notes' && (
        <section className="mb-8 rounded-lg border bg-card p-5">
          {/* Freeform character notes (markdown + dropped media) — background,
              art direction, references. Stored as <Name>.notes.md next to the
              definition; media in the project's .dcsmeta/media. */}
          <NotesEditor
            projectId={projectId}
            characterId={initial.id}
            placeholder={`Describe ${character.name}'s background in markdown — drop images or other files right into the editor…`}
          />
        </section>
      )}

      <div className={activeTab !== 'character' ? 'hidden' : undefined}>
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
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="G9">G9</SelectItem>
                    <SelectItem value="G8.1">G8.1</SelectItem>
                    <SelectItem value="G8">G8</SelectItem>
                    <SelectItem value="G3">G3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="mb-1">Gender</Label>
                <Select
                  value={character.gender}
                  onValueChange={(v) => patch({ gender: v as Character['gender'] })}
                >
                  <SelectTrigger className="w-40">
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
              on the same baseline as the Genesis row on the left (-mt-2 lifts the
              box, pt-2 on the left column matches). The box always shows; on
              non-G9 characters the native fieldset `disabled` turns off every
              control inside (the strengths and tear UV only exist on Genesis 9
              figures) and the text goes muted. */}
          <fieldset
            disabled={character.genesis !== 'G9'}
            className="relative -mt-2 self-start rounded-md border px-4 pt-4 pb-4"
          >
              <legend className="absolute -top-2 left-3 bg-card px-1 text-xs font-medium text-muted-foreground uppercase">
                Genesis 9 Specific
              </legend>
              <div
                className={`space-y-4${character.genesis === 'G9' ? '' : ' text-muted-foreground'}`}
              >
                {/* The strengths are stored raw (1 = 100%) but shown Daz-style as
                    percentages, same as every morph value field. */}
                <div className="flex flex-wrap gap-4">
                  <div>
                    <Label className="mb-1" title="G9 FACS Detail Strength, set at frame 0">
                      FACS detail strength
                    </Label>
                    <NumberField
                      className="w-28 pr-6 text-right tabular-nums"
                      suffix="%"
                      value={+(character.facsDetailStrength * 100).toFixed(4)}
                      onCommit={(pct) => patch({ facsDetailStrength: +(pct / 100).toFixed(6) })}
                    />
                  </div>
                  <div>
                    <Label className="mb-1" title="G9 Flexion Automatic Strength, set at frame 0">
                      Flexion strength
                    </Label>
                    <NumberField
                      className="w-28 pr-6 text-right tabular-nums"
                      suffix="%"
                      value={+(character.flexionStrength * 100).toFixed(4)}
                      onCommit={(pct) => patch({ flexionStrength: +(pct / 100).toFixed(6) })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={character.applyUE5TearUV}
                    onCheckedChange={(applyUE5TearUV) => patch({ applyUE5TearUV })}
                  />
                  <span className="flex items-center gap-1 text-sm">
                    Set UE5 tear UV
                    <InfoPopup label="Set UE5 tear UV — more information">
                      Switches the Genesis 9 Tear figure's shader UV set to “UE5” during the
                      ROM build, so DTH's Lacrimal Fluid material lines up without the manual
                      Surfaces-tab step.
                    </InfoPopup>
                  </span>
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
                Where the generated <code>ROM_{character.name}_{character.genesis}.dsa</code> script
                is installed in your DAZ library on Save — open it from Daz to build the ROM
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
      </div>

      {project?.dazProductsEnabled && (
        <div className={onProductsTab ? undefined : 'hidden'}>
          <CharacterProductsTab
            projectId={projectId}
            character={character}
            productScan={productScan}
            dimManifestsFolder={settings.dimManifestsFolder}
            scriptsAbs={scriptsAbs}
            scriptsLib={scriptsLib}
            scriptsSuffix={scriptsSuffix}
            onStored={draft.settle}
          />
        </div>
      )}

      <div className={activeTab !== 'character' ? 'hidden' : undefined}>
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
                onClick={() => void draft.patchAndRegenerate({ exportPath: '' }, 'Export folder cleared — script regenerated')}
              >
                <X /> Clear
              </Button>
            </>
          )}
        </div>
        {!character.exportPath && boneScaleFrames > 0 && (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-500">
            {boneScaleFrames === 1 ? '1 frame is' : `${boneScaleFrames} frames are`} marked{' '}
            <strong>bone scale</strong> — set an export directory so the DTH Exporter can generate
            {boneScaleFrames === 1 ? ' its' : ' their'} reference-skeleton FBX.
          </p>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Switch
            checked={character.exportSceneSubfolders}
            disabled={!character.exportPath}
            onCheckedChange={(exportSceneSubfolders) =>
              void draft.patchAndRegenerate(
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
              void draft.patchAndRegenerate(
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
              On: one <code>ROM_{character.name}_{character.genesis}.dsa</code> builds the ROM and
              runs the export. Off: the export splits into its own{' '}
              <code>Export_{character.name}_{character.genesis}.dsa</code> beside the ROM script, so
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
          <PreserveFields character={character} patch={patch} />
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
        {presetFrames && (
          <div className="mb-4 rounded-lg border bg-card p-3">
            <RomTimeline
              segments={romTimeline(character.sections, character.gender, presetFrames)}
            />
          </div>
        )}
        <RomSections
          sections={character.sections}
          genesis={character.genesis}
          gender={character.gender}
          skinning={characterSkinning(character)}
          catalog={catalog}
          presetFrames={presetFrames}
          failedFrames={failedFrames}
          revealFrame={revealFrame}
          revealPose={revealPose}
          morphIndex={morphIndex}
          jcmMorphMods={character.jcmMorphMods}
          onJcmMorphModsChange={(jcmMorphMods) => patch({ jcmMorphMods })}
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
            patch({ image })
            try {
              const saved = await saveCharacter({ data: { projectId, character: updated } })
              draft.settle(saved)
              void router.invalidate()
              toast.success('Image updated')
            } catch (e) {
              // Roll the optimistic update back so the editor isn't stuck dirty.
              patch({ image: character.image })
              toast.error(e instanceof Error ? e.message : String(e))
            }
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
