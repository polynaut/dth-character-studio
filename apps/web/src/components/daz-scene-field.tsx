import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject, Ref } from 'react'
import { FolderInput, Link2, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { DirPathChip, displayDirOf } from '#/components/dir-path-chip.tsx'
import { PathCode } from '#/components/path-code.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { Button, Input, Label, LinkedAssetCard, Modal, RemoveAssetDialog, useModifierHeld } from '@dth/ui'
import { PrimaryBadge } from '#/components/primary-badge.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import type { SceneDockActions } from '#/components/character/scene-footer.tsx'
import { SceneCopyDialog } from '#/components/scene-copy-dialog.tsx'
import dazLogo from '#/assets/daz-logo.png'
import {
  copyDazScene,
  dazStudioRunning,
  deleteFiles,
  moveCharacterScenesFolder,
  openScene,
  revealPath,
  relinkScene,
  sceneWearables,
} from '#/lib/rom/api.ts'
import { SceneValidationTable } from '#/components/scene-compat.tsx'
import { primarySceneDerivation, sceneCompatFailed, sceneCompatRows } from '#/lib/scene-compat.ts'
import { pickDufPath, pickFolder } from '#/lib/desktop.ts'
import { displayPath, extrasWithoutPrimary, normalizePath, parentDir } from '#/lib/path.ts'

import type { CharacterLocation, SceneWearables } from '#/lib/rom/api.ts'
import type { PersistCharacterPatch } from '#/lib/use-character-draft.ts'
import type { Character } from '@dth/rom'

/**
 * A linked Daz scene as a clickable card — its `.tip.png` portrait, the
 * filename, and the Daz badge; clicking the whole card opens the scene in Daz.
 */
function SceneCard({
  scenePath,
  name,
  onOpen,
  onRemove,
  primary,
  selected,
  onSelect,
}: {
  scenePath: string
  name: string
  onOpen: (e: React.MouseEvent) => void
  /** When set, a hover ✕ unlinks the scene from the character (file is kept). */
  onRemove?: () => void
  /** The character's original creation scene — gets a "primary" badge and is not
   *  unlinkable (the caller omits onRemove). */
  primary?: boolean
  /** Selectable mode (see LinkedAssetCard): card click selects, icon opens. */
  selected?: boolean
  onSelect?: () => void
}) {
  const fileName = scenePath.split(/[\\/]/).pop() ?? scenePath
  // The heading shows the scene name without its extension (e.g. ".duf").
  const displayName = fileName.replace(/\.[^./\\]+$/, '')
  // Alt held → the open icon previews the alternate action (show in Explorer).
  const altHeld = useModifierHeld('Alt')
  return (
    <LinkedAssetCard
      title={displayName}
      media={
        <Portrait
          scenePath={scenePath}
          name={name}
          className="aspect-[3/4] w-14 shrink-0 rounded-md"
          fallbackClassName="text-xl"
        />
      }
      // Daz brand mark, floating bottom-left as a badge on the portrait.
      badge={
        <img
          src={dazLogo}
          alt=""
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 size-6 object-contain drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)]"
        />
      }
      extra={
        primary ? (
          <PrimaryBadge title="The character's original scene — it can't be unlinked" />
        ) : undefined
      }
      altHeld={altHeld}
      openTitle="Open in Daz"
      accentClass="group-hover:text-daz-green"
      cardClass="daz-card"
      barClass="bg-daz-green"
      checkClass="bg-daz-green"
      onOpen={onOpen}
      onRemove={onRemove}
      removeTitle="Unlink from character"
      selected={selected}
      onSelect={onSelect}
    />
  )
}

/**
 * The character's Daz scenes: the primary `scenePath` plus any `extraScenes`
 * (outfit variants), each shown as a card that opens it in Daz. "Add scene"
 * picks another `.duf`; one outside the character folder pauses on a modal that
 * copies it into the scenes folder (the modal's subdir nests inside that). The
 * primary still uses the link/relink flow (it's also the avatar source).
 */
export function DazSceneField({
  projectId,
  character,
  location,
  sceneExists,
  sceneFolderExists,
  defaultSubdir,
  persistPatch,
  onScenesFolderMoved,
  selectedScene,
  onSelectScene,
  cardsRef,
  dockActionsRef,
}: {
  projectId: string
  character: Character
  location: CharacterLocation
  sceneExists: boolean
  sceneFolderExists: boolean
  defaultSubdir: string
  /** The draft hook's immediate-persist primitive — every link/unlink flow goes
   *  through it so validation, single-flight and regeneration are never skipped. */
  persistPatch: PersistCharacterPatch
  /** A scenes-FOLDER move repoints paths but reads the character from DISK, so its
   *  result must be MERGED into the draft (preserving unsaved edits), never used to
   *  replace it wholesale like a scene link does — see the route's `syncPersisted`. */
  onScenesFolderMoved: (character: Character) => void
  /** Selectable cards (see LinkedAssetCard): pass the selected scene path and a
   *  setter — a card click selects (only the corner icon opens). Omit both for
   *  the classic click-to-open cards. */
  selectedScene?: string
  onSelectScene?: (scene: string) => void
  /** Ref for the scene-cards grid — lets the page tell when the selection area
   *  (the cards, not the "Add scene" button below them) scrolls out of view, so
   *  the docked scene footer appears the moment the cards leave. */
  cardsRef?: Ref<HTMLDivElement>
  /** Populated with this field's add/unlink flows so the docked scene bar
   *  (SceneFooter) can drive them without duplicating the modals. */
  dockActionsRef?: MutableRefObject<SceneDockActions | null>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A scene click while Daz is already running: the studio can't switch a running
  // Daz's scene, so this holds the clicked scene path to drive the warning dialog.
  const [dazWarn, setDazWarn] = useState<string | null>(null)
  // Polled while that dialog is up. Opening into a running Daz never works, so the
  // dialog tells the user to close Daz; once it's closed this flips false and the
  // button becomes "Open now" (which launches a fresh Daz with the scene).
  const [dazStillRunning, setDazStillRunning] = useState(true)
  // A picked scene outside the project pauses here awaiting the copy decision.
  const [pending, setPending] = useState('')
  const [subfolder, setSubfolder] = useState(() => defaultSubdir)
  // A picked *additional* scene awaiting its add dialog — separate from the
  // primary link flow. Its subfolder nests inside the existing scenes folder.
  const [pendingAdd, setPendingAdd] = useState('')
  const [addSubfolder, setAddSubfolder] = useState('')
  // The add dialog's validation reads: the picked scene + the primary scene (the
  // geograft reference) — null while the reads are in flight. `forceAdd` is the
  // "Add anyway" escape past failed checks.
  const [addScan, setAddScan] = useState<{
    scene: SceneWearables
    primary: SceneWearables | null
  } | null>(null)
  const [forceAdd, setForceAdd] = useState(false)
  // Supersede stale reads (repick before the previous read resolved).
  const addScanId = useRef(0)
  // When on, the source scene is deleted after copying (a move). Off by default;
  // mutually exclusive with "Link in place" (which keeps the original in place).
  const [deleteOriginal, setDeleteOriginal] = useState(false)
  // A scene pending the unlink confirm + whether to also delete it from disk.
  const [pendingRemove, setPendingRemove] = useState('')
  const [removeDeleteFile, setRemoveDeleteFile] = useState(false)
  // Editing the scenes subfolder (the chip's pencil): null = not editing,
  // otherwise the draft value relative to the character folder.
  const [editDir, setEditDir] = useState<string | null>(null)
  // Guards onOpen against a double-click launching Daz twice (a ref, so it takes
  // effect synchronously within the same tick — a state flag would lag a render).
  const openingRef = useRef(false)

  const linked = Boolean(character.scenePath)
  const ready = linked && sceneExists
  // The whole scenes folder is gone (renamed/moved outside the app) — offer to
  // re-link it, which re-points every scene path to the folder's new location.
  const folderMissing = linked && !sceneFolderExists
  function insideProject(p: string): boolean {
    return normalizePath(p).toLowerCase().startsWith(normalizePath(location.libraryFolder).toLowerCase() + '/')
  }
  // The character's own folder, and the primary scene's folder relative to it
  // (e.g. "daz3d") — added scenes are copied there; the modal subdir nests inside.
  const charFolder = parentDir(location.definitionAbs)
  function insideCharFolder(p: string): boolean {
    return normalizePath(p).toLowerCase().startsWith(charFolder.toLowerCase() + '/')
  }
  // Every scene already attached to this character (primary + extras). A scene is
  // linked at most once, so a pick/drop that repeats one is rejected up front.
  const linkedScenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  function isAlreadyLinked(p: string): boolean {
    const target = normalizePath(p).toLowerCase()
    return linkedScenes.some((s) => normalizePath(s).toLowerCase() === target)
  }
  const primaryDir = character.scenePath ? parentDir(character.scenePath) : ''
  const baseDazRel =
    primaryDir && primaryDir.toLowerCase().startsWith(charFolder.toLowerCase() + '/')
      ? primaryDir.slice(charFolder.length + 1)
      : defaultSubdir
  const cleanSub = (s: string) => s.split(/[\\/]+/).filter(Boolean).join('/')

  // Alt+click = the app-wide "show in Explorer" hotkey (same as path chips
  // and the Unreal cards); plain click opens the scene in Daz.
  async function onOpen(scenePath: string, e?: React.MouseEvent) {
    // Re-entry guard: a fast double-click would otherwise fire two openScene calls
    // and, with Daz closed, launch two fresh Daz instances.
    if (openingRef.current) return
    openingRef.current = true
    setError('')
    try {
      if (e?.altKey) {
        await revealPath({ data: { path: scenePath } })
        return
      }
      // The studio can't switch the scene of an already-running Daz (a forwarded
      // open is dropped once a scene is loaded) — warn and point at the per-character
      // open script. With Daz closed, opening launches it fresh, which works.
      if (await dazStudioRunning()) {
        setDazWarn(scenePath)
        return
      }
      await openScene({ data: { scenePath } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(e?.altKey ? msg : `Couldn't open in Daz: ${msg}`)
    } finally {
      openingRef.current = false
    }
  }

  // Opens the clicked scene: reliably once Daz is closed (a fresh launch), or a
  // best-effort forward while Daz is still up (which only lands in an idle Daz).
  async function openAnyway() {
    const scene = dazWarn
    setDazWarn(null)
    if (!scene) return
    try {
      await openScene({ data: { scenePath: scene } })
    } catch (err) {
      toast.error(`Couldn't open in Daz: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // While the "already open" dialog is up, poll Daz's running state so the button
  // can switch to "Open now" the moment the user closes Daz (it needs a few
  // seconds to fully quit).
  useEffect(() => {
    if (dazWarn === null) return
    setDazStillRunning(true)
    let active = true
    const id = window.setInterval(() => {
      void dazStudioRunning().then((running) => active && setDazStillRunning(running))
    }, 2000)
    return () => {
      active = false
      window.clearInterval(id)
    }
  }, [dazWarn])

  // The scenes folder was renamed/moved on disk. Pick its new location (opening
  // in the character folder) and re-point every scene path under the old folder
  // to the new one, preserving each scene's relative subpath.
  async function onRelinkFolder() {
    const picked = await pickFolder('Select the Daz scenes folder', charFolder)
    if (!picked) return
    setBusy(true)
    setError('')
    const oldBase = parentDir(character.scenePath)
    const newBase = normalizePath(picked)
    const repoint = (p: string) => {
      const rel = normalizePath(p)
      return rel.toLowerCase().startsWith(oldBase.toLowerCase() + '/')
        ? `${newBase}/${rel.slice(oldBase.length + 1)}`
        : p // a scene linked outside the folder is left untouched
    }
    await persistPatch(
      {
        scenePath: repoint(character.scenePath),
        extraScenes: character.extraScenes.map(repoint),
      },
      { toast: 'Relinked the Daz scenes folder' },
    )
    setBusy(false)
  }

  // Open the add dialog for a picked/dropped scene and kick off its validation
  // reads. The dialog ALWAYS opens now — an in-folder scene just skips the copy
  // controls — so the compatibility checks are seen before anything links.
  function startAdd(picked: string) {
    setAddSubfolder('')
    setDeleteOriginal(false)
    setForceAdd(false)
    setAddScan(null)
    setPendingAdd(picked)
    const scanId = (addScanId.current += 1)
    const primary = character.scenePath
    void Promise.all([
      sceneWearables({ data: { scenePath: picked } }),
      primary
        ? sceneWearables({ data: { scenePath: primary } })
        : Promise.resolve<SceneWearables | null>(null),
    ]).then(([scene, primaryScan]) => {
      if (scanId !== addScanId.current) return
      setAddScan({ scene, primary: primaryScan })
    })
  }

  async function onAddPick() {
    const picked = await pickDufPath('Select another Daz scene (.duf)')
    if (!picked) return
    startAdd(picked)
  }

  async function applyAdd(scene: string, copyInto: boolean) {
    const sceneName = scene.split(/[\\/]/).pop() ?? scene
    const destSubfolder = [baseDazRel, cleanSub(addSubfolder)].filter(Boolean).join('/')
    // Reject a scene that's already attached, before any copy runs. An in-place add
    // compares the picked path itself; a copy compares its destination inside the
    // character folder — which catches re-copying the same external scene (its source
    // path differs from the in-folder copy, but the destination collides, which would
    // otherwise overwrite the existing copy and add a duplicate card). Checking up
    // front also means a `deleteOriginal` move never deletes the source then bails.
    const dest = copyInto ? [charFolder, destSubfolder, sceneName].filter(Boolean).join('/') : scene
    if (isAlreadyLinked(dest)) {
      toast.error(`“${sceneName}” is already linked to this character.`)
      return
    }
    setBusy(true)
    setError('')
    // The copy runs INSIDE the persist primitive's async patch producer — after
    // its validate/single-flight guards, so an up-front refusal never runs it.
    // Once it HAS run, the hook guarantees the copied (or, with deleteOriginal,
    // MOVED) file is never stranded: if interim edits typed during the copy
    // invalidate the merged draft, the patch alone still persists (against the
    // pre-producer draft), keeping those edits dirty on top.
    const saved = await persistPatch(
      async () => {
        const finalScene = copyInto
          ? await copyDazScene({
              data: {
                projectId,
                characterId: character.id,
                scenePath: scene,
                subfolder: destSubfolder,
                deleteOriginal,
              },
            })
          : scene
        return { extraScenes: [...character.extraScenes, finalScene] }
      },
      { toast: 'Added Daz scene' },
    )
    if (saved) setPendingAdd('')
    setBusy(false)
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
    // Copy inside the patch producer (see applyAdd); relinkScene is the persist
    // step — it saves the character itself and derives the avatar alongside.
    const saved = await persistPatch(
      async () => {
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
        // A scene is linked at most once: if the new primary is already an extra
        // (relinking the primary onto an existing outfit scene), drop it from the
        // extras so it isn't both — else it shows as two cards and collides the
        // footer's per-path key + view-transition-name.
        const patch: Partial<Character> = {
          scenePath: finalScene,
          extraScenes: extrasWithoutPrimary(character.extraScenes, finalScene),
        }
        // The primary scene DRIVES the scene-derived fields (one rule, shared
        // with createCharacter): the GEN section's enabled state follows the
        // scene's GP/DK geograft, and the gender is read from the figure id /
        // geograft — neither is user-editable anymore, so choosing a primary
        // re-derives both. Unreadable scene → keep the stored values.
        const scan = await sceneWearables({ data: { scenePath: finalScene } })
        const derived = primarySceneDerivation(scan, character)
        if (derived.gender) {
          patch.gender = derived.gender
          toast.info(`Gender set to ${derived.gender} — read from the scene.`)
        }
        if (derived.sections) {
          patch.sections = derived.sections
          const genEnabled = derived.sections.GEN.enabled
          if (genEnabled !== character.sections.GEN.enabled) {
            toast.info(
              genEnabled
                ? 'Genitalia section enabled — the scene contains a GP/DK geograft.'
                : 'Genitalia section disabled — no GP/DK geograft in the scene.',
            )
          }
        }
        return patch
      },
      {
        toast: 'Linked Daz scene',
        persist: (updated) =>
          relinkScene({ data: { projectId, character: updated, scenePath: updated.scenePath } }),
      },
    )
    if (saved) setPending('')
    setBusy(false)
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
      startAdd(scene)
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
    // Collapse the scene list (primary + extras), promoting the first remaining
    // scene to primary when the primary itself was removed.
    const all = [character.scenePath, ...character.extraScenes].filter(Boolean)
    const remaining = all.filter((s) => s !== scene)
    // Persist the unlink FIRST, delete the files only on success — the other way
    // round a failed save left the character pointing at already-deleted files.
    const saved = await persistPatch(
      { scenePath: remaining[0] ?? '', extraScenes: remaining.slice(1) },
      { toast: removeDeleteFile ? 'Deleted Daz scene' : 'Unlinked Daz scene' },
    )
    if (saved) {
      setPendingRemove('')
      if (removeDeleteFile) {
        try {
          const noDuf = scene.replace(/\.duf$/i, '')
          await deleteFiles({
            data: { paths: [scene, `${scene}.png`, `${scene}.tip.png`, `${noDuf}.tip.png`] },
          })
        } catch (e) {
          // Non-fatal: the unlink is already persisted — the file just stays.
          toast.warning(
            `Unlinked, but couldn't delete the scene files: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
    }
    setBusy(false)
  }

  // Add-dialog validation (see scene-compat.tsx): the checks evaluate over the
  // two scene reads; a definite failure gates the confirm actions behind the
  // "Add anyway" switch, and so does reads-still-in-flight (they resolve in
  // well under a second — a slow network share shows "checking…").
  const addRows = sceneCompatRows({
    scan: addScan?.scene ?? null,
    primaryScan: addScan?.primary ?? null,
    character,
  })
  const addChecking = pendingAdd !== '' && addScan === null
  const addBlocked = addChecking || (sceneCompatFailed(addRows) && !forceAdd)
  const addValidation = (
    <SceneValidationTable
      rows={addRows}
      loading={addChecking}
      force={forceAdd}
      onForceChange={setForceAdd}
      forceLabel="Add anyway — a failed check usually means the scene's ROM won't match"
    />
  )
  const addBlockedTitle = addChecking
    ? 'Checking the scene…'
    : 'A validation check failed — see the table above (or flip “Add anyway”)'

  // Two-tone path chip for the scenes' folder (the primary scene's directory):
  // everything through the CHARACTER folder is dimmed — we're already inside the
  // character here, so only the actual scenes subfolder ("\daz3d") reads bright.
  // A scene outside the character folder falls back to dimming the project root.
  const sceneDir = displayDirOf(character.scenePath)
  // The scenes subfolder relative to the character folder ('' when the scene is
  // linked from outside it) — that's the editable part of the chip.
  const sceneDirAbs = parentDir(character.scenePath)
  const sceneDirRel = insideCharFolder(character.scenePath)
    ? sceneDirAbs.slice(charFolder.length + 1)
    : ''
  const sceneDirChip = (
    <DirPathChip
      dir={sceneDir}
      roots={[displayPath(charFolder), displayPath(location.libraryFolder)]}
      onEdit={sceneDirRel && !busy ? () => setEditDir(displayPath(sceneDirRel)) : undefined}
    />
  )

  async function onMoveScenesDir() {
    if (editDir === null || !editDir.trim()) return
    const newSubdir = editDir
    setBusy(true)
    setError('')
    try {
      // Through the draft's persist primitive, like every other persisting flow:
      // the single-flight `saving` flag is held for the whole move+save+generate
      // (a bare api call raced an in-flight save), and persistPatch's
      // notifyGenerated surfaces the success toast + a soft scriptsError warning
      // exactly once. The move itself is the PERSIST step — it saves the draft
      // with its scene paths repointed and returns the persisted character.
      const saved = await persistPatch(
        {},
        {
          toast: 'Moved the Daz scenes folder',
          // The inline editor owns the error surface — a failed move/save shows
          // next to the input (guard refusals still toast in the hook).
          rethrow: true,
          persist: (updated) =>
            moveCharacterScenesFolder({ data: { projectId, character: updated, newSubdir } }),
        },
      )
      if (saved) {
        // MERGE the repointed paths into the draft + baseline — edits typed
        // DURING the move aren't in `saved`, so the hook's settle keeps the
        // draft; without this merge those kept scene paths would still point at
        // the old folder (and read as pending reverse-changes).
        onScenesFolderMoved(saved)
        setEditDir(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Share the pick+link and unlink flows with the docked scene bar (SceneFooter):
  // it drives the SAME handlers — whose pick dialog / copy / confirm modals all
  // live in THIS field — instead of duplicating them. Reassigned every render so
  // the handlers' closures stay current; nulled on unmount.
  useEffect(() => {
    if (!dockActionsRef) return
    dockActionsRef.current = {
      add: () => void onAddPick(),
      open: (scenePath, e) => void onOpen(scenePath, e),
      remove: (scenePath: string) => askRemove(scenePath),
    }
    return () => {
      dockActionsRef.current = null
    }
  })

  return (
    <FileDropZone
      accept={['duf']}
      onDrop={onDropScene}
      label={linked ? 'Drop a Daz scene (.duf) to add' : 'Drop a Daz scene (.duf) to link'}
      className="rounded-lg"
    >
      <Label id="daz-scenes" className="mb-3 block scroll-mt-28 text-xl font-semibold">
        Daz scenes
      </Label>
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
            {/* Copyable path to the scenes' folder, above the cards. The chip's
                pencil swaps it for an inline editor: the new subfolder (relative
                to the character folder) physically moves the folder on disk and
                repoints every linked scene. */}
            {editDir === null ? (
              <p className="mb-2 text-xs">{sceneDirChip}</p>
            ) : (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Scenes subfolder:</span>
                <Input
                  value={editDir}
                  autoFocus
                  disabled={busy}
                  className="h-7 w-64 font-mono text-xs"
                  onChange={(e) => setEditDir(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void onMoveScenesDir()
                    if (e.key === 'Escape') setEditDir(null)
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !editDir.trim()}
                  onClick={() => void onMoveScenesDir()}
                >
                  {busy ? 'Moving…' : 'Move'}
                </Button>
                <Button
                  variant="ghost-destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() => setEditDir(null)}
                >
                  Cancel
                </Button>
              </div>
            )}
            <div ref={cardsRef} className="flex flex-wrap items-stretch gap-3">
              {ready ? (
                <SceneCard
                  scenePath={character.scenePath}
                  name={character.name}
                  onOpen={(e) => void onOpen(character.scenePath, e)}
                  primary
                  selected={selectedScene !== undefined ? selectedScene === character.scenePath : undefined}
                  onSelect={onSelectScene ? () => onSelectScene(character.scenePath) : undefined}
                />
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-destructive/50 p-3 py-8 text-sm text-muted-foreground">
                  Primary scene missing.
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void onPick()}>
                    <Link2 /> Relink
                  </Button>
                </div>
              )}
              {character.extraScenes.map((scene) => (
                <SceneCard
                  key={scene}
                  scenePath={scene}
                  name={character.name}
                  onOpen={(e) => void onOpen(scene, e)}
                  onRemove={() => askRemove(scene)}
                  selected={selectedScene !== undefined ? selectedScene === scene : undefined}
                  onSelect={onSelectScene ? () => onSelectScene(scene) : undefined}
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

      {pending && (
        <Modal
          open
          onClose={() => setPending('')}
          title="Copy the Daz scene into the project?"
          dismissible={!busy}
        >
          <p className="text-sm text-muted-foreground">
            The selected scene lives outside this project. Copy it into the character's folder?
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
        </Modal>
      )}

      {pendingAdd &&
        (insideCharFolder(pendingAdd) ? (
          // Already inside the character folder — no copy decision, but the add
          // still pauses on the validation checks before it links.
          <Modal
            open
            onClose={() => setPendingAdd('')}
            title="Add Daz scene to the character?"
            dismissible={!busy}
          >
            <div>
              <Label className="mb-1 block">Selected file</Label>
              <PathCode path={displayPath(pendingAdd)} className="flex h-9 items-center" />
            </div>
            {addValidation}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" className="mr-auto" disabled={busy} onClick={() => setPendingAdd('')}>
                Cancel
              </Button>
              <Button
                disabled={busy || addBlocked}
                title={addBlocked ? addBlockedTitle : undefined}
                onClick={() => void applyAdd(pendingAdd, false)}
              >
                {busy ? 'Adding…' : 'Add scene'}
              </Button>
            </div>
          </Modal>
        ) : (
          <SceneCopyDialog
            title="Add Daz scene to the character?"
            description="The selected scene lives outside the character folder. Copy it into the character folder?"
            filePath={pendingAdd}
            prefix={displayPath(`${baseDazRel}/`)}
            subfolder={addSubfolder}
            onSubfolderChange={setAddSubfolder}
            deleteOriginal={deleteOriginal}
            onDeleteOriginalChange={setDeleteOriginal}
            busy={busy}
            error={error}
            copyLabel="Copy & add"
            validation={addValidation}
            confirmDisabled={addBlocked}
            confirmDisabledTitle={addBlockedTitle}
            onCopy={() => void applyAdd(pendingAdd, true)}
            onLink={() => void applyAdd(pendingAdd, false)}
            onClose={() => setPendingAdd('')}
          />
        ))}

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

      {dazWarn !== null && (
        <Modal open onClose={() => setDazWarn(null)} title="Daz Studio is already open">
          <p className="text-sm text-muted-foreground">
            The studio can't load a scene into a running Daz. To open{' '}
            <strong>{character.name}</strong>, <strong>close Daz Studio</strong> and give it a few
            seconds to fully quit — the button below then switches to <strong>Open now</strong> and
            opens it in a fresh Daz.
          </p>
          <p className="text-xs text-muted-foreground">
            {dazStillRunning
              ? 'Waiting for Daz Studio to close…'
              : 'Daz Studio is closed — ready to open.'}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant={dazStillRunning ? 'outline' : 'default'}
              onClick={() => void openAnyway()}
            >
              {dazStillRunning ? 'Open anyway' : 'Open now'}
            </Button>
            <Button variant="outline" onClick={() => setDazWarn(null)}>
              Got it
            </Button>
          </div>
        </Modal>
      )}
    </FileDropZone>
  )
}
