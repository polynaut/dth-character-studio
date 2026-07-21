import { useEffect, useRef, useState } from 'react'
import { createFileRoute, notFound, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { InfoPopup, Tabs, TabsList, TabsTrigger, useRefetchOnFocus } from '@dth/ui'
import { GuideLink } from '#/components/guide-link.tsx'
import {
  fetchCharacter,
  fetchPoseAssets,
  fetchProductScan,
  fetchProject,
  fetchMorphIndex,
  fetchRomRunLog,
  syncAvatarWithScene,
  fetchSettings,
  fileExists,
  getCharacterPath,
  moveCharacter,
  setActiveProjectDir,
  resolvePresetFrames,
} from '#/lib/rom/api.ts'
import { CharacterProductsTab } from '#/components/character-products-tab.tsx'
import { DeleteCharacterSection } from '#/components/character/delete-character-section.tsx'
import { EditorHeader } from '#/components/character/editor-header.tsx'
import { ExportSettingsSection } from '#/components/character/export-settings-section.tsx'
import { GroomFields } from '#/components/character/groom-fields.tsx'
import { IdentitySection } from '#/components/character/identity-section.tsx'
import { PreserveFields } from '#/components/character/preserve-fields.tsx'
import { RomEditorSection } from '#/components/character/rom-editor-section.tsx'
import { RomRunLogReport } from '#/components/character/rom-run-log-report.tsx'
import { ScriptsSection } from '#/components/character/scripts-section.tsx'
import { NotesEditor } from '#/components/notes-editor.tsx'
import { DazSceneField } from '#/components/daz-scene-field.tsx'
import { HoudiniProjectsField } from '#/components/houdini-projects-field.tsx'
import { StorageLocation } from '#/components/storage-location.tsx'
import { characterFolderDisplay, characterScriptsDisplay } from '#/lib/character-paths.ts'
import { displayPath, parentDir } from '#/lib/path.ts'
import { repointCharacterPaths } from '#/lib/rom/storage.ts'
import { useCharacterDraft } from '#/lib/use-character-draft.ts'
import { useFolderMove } from '#/lib/use-folder-move.tsx'
import { useRomRunLog } from '#/lib/use-rom-run-log.ts'
import { useSceneSelection } from '#/lib/use-scene-selection.ts'
import { presetFramesSignature } from '@dth/rom'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'
import type { Character, PresetFrames, RomSection } from '@dth/rom'

export const Route = createFileRoute('/projects/$projectId/characters/$characterId')({
  loader: async ({ params, preload }) => {
    const { projectId, characterId: id } = params
    // The route param IS the project's folder — pin it so avatars resolve. NOT on
    // a hover preload though: that mutates window-global state (avatar resolution)
    // for a navigation that may never happen.
    if (!preload) setActiveProjectDir(projectId)
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
      // so problems show the moment the user switches back to the studio. A
      // hover PRELOAD must not ingest (ingesting deletes the Daz-written file —
      // hovering a card would race Daz mid-write); it reads the stored copy.
      fetchRomRunLog({ data: { projectId, id, ingest: !preload } }),
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
 * Same scanned morph index, by content? Entries are four short strings each, so
 * a full field compare stays far cheaper than the downstream cost of a false
 * "changed" (re-running the ROM-editor memos over the whole index).
 */
function sameMorphIndex(a: Array<MorphIndexEntry>, b: Array<MorphIndexEntry>): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((e, i) => {
    const o = b[i]
    return (
      e.node === o.node && e.name === o.name && e.label === o.label && e.nodeLabel === o.nodeLabel
    )
  })
}

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
  const { character, patch } = draft

  // Preset ROM block lengths, re-measured from the .duf assets whenever the
  // preset/custom selections change (kept from the last good measure during a
  // re-measure; null only when an included asset can't be read).
  const [presetFrames, setPresetFrames] = useState<PresetFrames | null>(initialFrames)
  // Only meaningful when the project enables Daz Products: splits this page into a
  // "Character" tab (everything) and a "Products" tab (the scan section).
  const [activeTab, setActiveTab] = useState<'character' | 'products' | 'notes'>('character')
  // Which Daz scene card is selected — groom lists, the header's scene tag and
  // the per-scene ROM override all follow it (lib/use-scene-selection.ts).
  const sceneSel = useSceneSelection(character, patch)
  // The ROM run log + the "reveal failed frame" signal for the editor.
  const runLog = useRomRunLog(projectId, initial.id, initialRomRunLog)

  // Scene-derived avatars mirror their source scene's preview, which Daz
  // rewrites on every scene save — re-sync on load and whenever the window
  // regains focus (tabbing back from Daz), so the avatar never goes stale.
  // Custom uploads have no source scene and are never touched.
  useRefetchOnFocus(
    () => {
      void syncAvatarWithScene({ data: { projectId, id: initial.id } })
        .then((changed) => {
          if (changed) draft.syncPersisted(changed)
        })
        // Best-effort: the project share can be briefly unreachable on refocus —
        // the avatar just stays stale until the next focus, never an unhandled
        // rejection.
        .catch(() => {})
    },
    [projectId, initial.id],
    { immediate: true },
  )

  // The scanned morph index for this generation (Scan_Morphs_<Genesis>.dsa →
  // app-data JSON) powering the Morph-name autocomplete. Loaded on mount and
  // re-read on window focus, so a scan just run in Daz is offered immediately.
  const [morphIndex, setMorphIndex] = useState<Array<MorphIndexEntry>>([])
  useRefetchOnFocus(
    () => {
      // Content-compare before storing: fetchMorphIndex returns a NEW array
      // identity when there is no scan file (or no readable stamp), so a plain
      // setMorphIndex would break the RomEditorSection/RomSections memos and
      // re-lowercase the whole index on every tab-back from Daz. Identity only
      // changes when the data does.
      void fetchMorphIndex(character.genesis).then((entries) =>
        setMorphIndex((prev) => (sameMorphIndex(prev, entries) ? prev : entries)),
      )
    },
    [character.genesis],
    { immediate: true },
  )

  // Re-measure the preset ROM block lengths when a preset/custom selection that
  // affects them changes (not on every custom-pose keystroke). Debounced; the
  // last good value is kept until the new one lands, so frame numbers don't
  // flicker. Null only when an included asset can't be read. Which fields count
  // is owned by @dth/rom (next to the path resolution), not hand-mirrored here.
  const presetSignature = presetFramesSignature(character)
  // Seeded with the mount signature: the loader just resolved these exact
  // selections, so the effect must not re-run them 300ms after mount (on a cold
  // network share the per-.duf stats stall). Only a real signature change
  // re-measures; the ref then tracks the last signature a measure was scheduled
  // for.
  const measuredSignatureRef = useRef(presetSignature)
  useEffect(() => {
    if (presetSignature === measuredSignatureRef.current) return
    measuredSignatureRef.current = presetSignature
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

  // The character's folder chip and where the generated scripts land — both
  // derived in lib/character-paths.ts (dim root, bright remainder).
  const folderChip = location ? characterFolderDisplay(location) : null
  const scriptsPath = characterScriptsDisplay(
    settings.dazLibraryFolder,
    character.projectName,
    character.name,
  )

  // A folder move can repoint the linked scene (it travels with the folder when
  // it lives inside it). Sync just the scene path into the draft + baseline so
  // the Daz scene field stays correct without discarding any unsaved edits.
  function onCharacterMoved(moved: Character) {
    draft.syncPersisted({ scenePath: moved.scenePath })
  }

  // The header folder chip's edit-to-move — the SAME move as Advanced options'
  // Storage location, through the shared lock gate + retry dialog (useFolderMove)
  // so a scene open in Daz surfaces the "close it and continue" prompt.
  const router = useRouter()
  const { runMove, dialog: folderMoveDialog } = useFolderMove()
  async function moveCharacterFolder(nextSubdir: string) {
    if (!location) return
    const fileName = location.definitionAbs.split(/[\\/]/).pop() ?? ''
    const subdir = nextSubdir.split(/[\\/]+/).filter(Boolean).join('/')
    const relPath = `${subdir}/${fileName}`
    const { character: moved } = await moveCharacter({
      data: { projectId, id: character.id, relPath },
    })
    await router.invalidate()
    onCharacterMoved(moved)
    toast.success(`Moved to ${displayPath(relPath)}`)
  }
  const folderMove = location
    ? {
        editValue: displayPath(location.relFolder),
        onMove: (next: string) => runMove(() => moveCharacterFolder(next)),
      }
    : null

  // Moving the Daz SCENES folder repoints every in-folder path but reads the
  // character from disk (no unsaved edits) — using settle here would discard
  // unsaved ROM edits AND clear `dirty`, so the unsaved-changes guard would never
  // fire. Instead, repoint the DRAFT's own paths old-dir→new-dir through THE
  // single repoint site (storage's repointCharacterPaths, the same one the move
  // used on disk): a hand-merged field list drifted from it before — it omitted
  // `sections[*].customAssetPath` and `houdiniProjects`, leaving phantom dirty
  // state whose next Save wrote the dead OLD paths back to disk. The updater
  // form runs per copy, so the already-settled baseline (paths at the new dir)
  // no-ops while a draft holding interim edits gets its old paths repointed.
  function onScenesFolderMoved(moved: Character) {
    const newDir = parentDir(moved.scenePath)
    draft.syncPersisted((current) => {
      const oldDir = parentDir(current.scenePath)
      // Already at the new folder (the settled baseline / a no-op move) —
      // nothing to repoint.
      if (!oldDir || !newDir || oldDir.toLowerCase() === newDir.toLowerCase()) return {}
      return repointCharacterPaths(current, oldDir, newDir)
    })
  }

  // When Daz Products is enabled the body splits into two tabs ("Character" /
  // "Products"). We keep both groups mounted and toggle visibility with `hidden`
  // rather than unmounting — cheaper, and it preserves scroll/edit state when
  // switching. Gate on the flag too: if the feature is disabled while the
  // Products tab is active, the character group must not stay hidden.
  const onProductsTab = !!project?.dazProductsEnabled && activeTab === 'products'

  return (
    <main className="p-8">
      {folderMoveDialog}
      <EditorHeader
        projectId={projectId}
        draft={draft}
        folderChip={folderChip}
        folderMove={folderMove}
        hasRunProblems={runLog.hasRunProblems}
        sceneTag={
          sceneSel.linkedScenes.length > 1 && sceneSel.selectedSceneName
            ? sceneSel.selectedSceneName
            : null
        }
        sceneAvatarPath={
          sceneSel.effectiveScene && sceneSel.effectiveScene !== character.scenePath
            ? sceneSel.effectiveScene
            : null
        }
      />

      {/* The editor body is isolated with `contain: layout paint`: when the sticky
          header collapses on scroll its height changes, and without this the whole
          (heavy) form would re-flow every frame on the main thread — the lag. With
          containment the browser only re-positions this one cached layer. The
          popup dialogs are portaled to <body> so this containment doesn't
          become their containing block and break their viewport positioning. */}
      <div className="contain-editor-body">
      {/* Above the tabs, so the report is visible from the Products tab too. */}
      {runLog.romRunLog && !runLog.romRunLog.ok && (
        <RomRunLogReport
          romRunLog={runLog.romRunLog}
          onDismiss={() => void runLog.dismiss()}
          onRevealFrame={runLog.revealFailedFrame}
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

      <div className={onProductsTab || activeTab === 'notes' ? 'hidden' : undefined}>
      <section className="mb-8 rounded-lg border bg-card p-5 pt-7">
        <IdentitySection
          character={character}
          patch={patch}
          overrideEligible={sceneSel.overrideEligible}
          identityOverrideActive={sceneSel.identityOverrideActive}
          setIdentityOverrideEnabled={sceneSel.setIdentityOverrideEnabled}
          selectedSceneName={sceneSel.selectedSceneName}
          sceneOverride={sceneSel.sceneOverride}
          patchOverride={sceneSel.patchOverride}
        />
        {location && (
          <div className="mt-6 space-y-4 border-t pt-5">
            <DazSceneField
              projectId={projectId}
              character={character}
              location={location}
              sceneExists={sceneExists}
              sceneFolderExists={sceneFolderExists}
              defaultSubdir={project?.dazSubdir ?? 'daz3d'}
              persistPatch={draft.persistPatch}
              onScenesFolderMoved={onScenesFolderMoved}
              selectedScene={sceneSel.effectiveScene}
              onSelectScene={sceneSel.selectScene}
            />
            {/* Groom lists are PER SCENE — living right under the scene cards makes
                the card-selection ↔ hair-list connection visible while switching. */}
            <GroomFields
              character={character}
              patch={patch}
              selectedScene={sceneSel.effectiveScene}
              dazInstallFolder={settings.dazInstallFolder}
              overrideEligible={sceneSel.overrideEligible}
              groomOverrideActive={sceneSel.groomOverrideActive}
              setGroomOverrideEnabled={sceneSel.setGroomOverrideEnabled}
              selectedSceneName={sceneSel.selectedSceneName}
            />
            <HoudiniProjectsField
              character={character}
              location={location}
              persistPatch={draft.persistPatch}
            />
          </div>
        )}
      </section>

      <ScriptsSection character={character} scriptsPath={scriptsPath} />
      </div>

      {project?.dazProductsEnabled && (
        <div className={onProductsTab ? undefined : 'hidden'}>
          <CharacterProductsTab
            projectId={projectId}
            character={character}
            productScan={productScan}
            dimManifestsFolder={settings.dimManifestsFolder}
            scriptsPath={scriptsPath}
            persistPatch={draft.persistPatch}
          />
        </div>
      )}

      <div className={onProductsTab || activeTab === 'notes' ? 'hidden' : undefined}>
      <ExportSettingsSection
        character={character}
        saving={draft.saving}
        persistPatch={draft.persistPatch}
        location={location}
        houdiniSubdir={project?.houdiniSubdir}
      />

      <details className="mb-8 rounded-lg border bg-card">
        <summary className="flex cursor-pointer items-center gap-1 px-5 py-3 font-medium select-none">
          Advanced options
          {/* preventDefault stops the info click from also toggling the <details>. */}
          <span onClick={(e) => e.preventDefault()} className="inline-flex">
            <InfoPopup label="Advanced options — more information">
              <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/04-first-character.html#advanced-options--storage-location-preserve-morphs---node-transforms">
                Storage location, preserve morphs &amp; node transforms — open the guide
              </GuideLink>
            </InfoPopup>
          </span>
        </summary>
        <div className="space-y-6 border-t p-5">
          <StorageLocation
            projectId={projectId}
            id={character.id}
            location={location}
            onMoved={onCharacterMoved}
          />
          <PreserveFields
            character={character}
            patch={patch}
            overrideEligible={sceneSel.overrideEligible}
            preserveOverrideActive={sceneSel.preserveOverrideActive}
            setPreserveOverrideEnabled={sceneSel.setPreserveOverrideEnabled}
            selectedSceneName={sceneSel.selectedSceneName}
            sceneOverride={sceneSel.sceneOverride}
            patchOverride={sceneSel.patchOverride}
          />
        </div>
      </details>

      <RomEditorSection
        character={character}
        patch={patch}
        catalog={catalog}
        presetFrames={presetFrames}
        failedFrames={runLog.failedFrames}
        revealFrame={runLog.revealFrame}
        revealPose={revealPose}
        morphIndex={morphIndex}
        overrideEligible={sceneSel.overrideEligible}
        overrideActive={sceneSel.overrideActive}
        selectedSceneName={sceneSel.selectedSceneName}
        sceneOverride={sceneSel.sceneOverride}
        setOverrideEnabled={sceneSel.setOverrideEnabled}
      />

      <DeleteCharacterSection
        projectId={projectId}
        character={character}
        dazSubdir={project?.dazSubdir ?? 'daz3d'}
        houdiniSubdir={project?.houdiniSubdir ?? 'houdini'}
        bypassUnsavedGuard={draft.unsavedGuard.bypass}
      />
      </div>
      </div>
    </main>
  )
}
