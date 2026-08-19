import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject, ReactNode, Ref } from 'react'
import { FolderInput, Link2, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { DirPathChip, displayDirOf } from '#/components/dir-path-chip.tsx'
import { FolderMoveChip } from '#/components/folder-move-chip.tsx'
import { MultipleDazModal } from '#/components/multiple-daz-modal.tsx'
import { PathCode, tallPathChipClass } from '#/components/path-code.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { Button, InfoPopup, Input, Label, LinkedAssetCard, Modal, RemoveAssetDialog, useModifierHeld, useRefetchOnFocus } from '@dth/ui'
import { GuideLink } from '#/components/guide-link.tsx'
import { PrimaryBadge } from '#/components/primary-badge.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import type { SceneDockActions } from '#/components/character/scene-footer.tsx'
import { DazSceneUtilsPanel } from '#/components/character/daz-scene-utils-panel.tsx'
import { SceneCopyDialog } from '#/components/scene-copy-dialog.tsx'
import { CardReorderContext, SortableCard } from '#/components/sortable-cards.tsx'
import dazLogo from '#/assets/daz-logo.png'
import {
  copyDazScene,
  MultipleDazInstancesError,
  dazStudioRunning,
  deleteFiles,
  fetchCharactersWithProblems,
  fetchRomAnimations,
  generateRomAnimation,
  moveCharacterScenesFolder,
  openScene,
  openSceneInRunningDaz,
  renameDazScene,
  revealPath,
  relinkScene,
  romAnimationFresh,
  sceneWearables,
} from '#/lib/rom/api.ts'
import { sceneExportSubfolders } from '@dth/rom'

import { romAnimationPath } from '#/lib/rom/execute-jobs.ts'
import { SceneValidationTable } from '#/components/scene-compat.tsx'
import {
  charactersLinkedScenes,
  primarySceneDerivation,
  sceneCompatFailed,
  sceneCompatHardFailed,
  sceneCompatRows,
  sceneNotLinkedRow,
} from '#/lib/scene-compat.ts'
import { pickDufPath, pickFolder } from '#/lib/desktop.ts'
import {
  PRIMARY_SCENE_SUBFOLDER,
  deriveScenesRootRel,
  sceneDeleteTargets,
  sceneSubfolderConflict,
  suggestSceneSubfolder,
} from '#/lib/scene-subfolder.ts'
import { browseStart, displayPath, extrasWithoutPrimary, normalizePath, parentDir } from '#/lib/path.ts'
import { addScenePatch, primaryLinkPatch } from '#/lib/scene-add.ts'
import { seedSceneHair } from '#/lib/groom-detect.ts'

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
  offsetY,
  onOpen,
  onRename,
  onRemove,
  onReplace,
  replaceDisabled,
  replaceReason,
  onUtils,
  primary,
  selected,
  onSelect,
  pathChip,
}: {
  scenePath: string
  name: string
  /** The character's `imageOffsetY` — its framing nudge, applied on top of the
   *  card's default face crop (see lib/avatar-offset). */
  offsetY?: number
  onOpen: (e: React.MouseEvent) => void
  /** Inline-rename the scene's files (in-folder scenes only — a linked-in-place
   *  scene is the user's original, its name stays theirs). */
  onRename?: (next: string) => Promise<void> | void
  /** When set, a hover ✕ unlinks the scene from the character (file is kept). */
  onRemove?: () => void
  /** When set, a hover folder button browses for a REPLACEMENT scene — the
   *  primary card's swap flow (the primary can't be unlinked, only replaced). */
  onReplace?: () => void
  /** Show the replace button but refuse it, with `replaceReason` as the
   *  tooltip — see the extra-scenes gate in DazSceneField. */
  replaceDisabled?: boolean
  /** Tooltip for the replace button; the REASON when it is disabled. */
  replaceReason?: string
  /** Opens the scene's Utils drawer (scans + the per-scene hair-export switch)
   *  — the 🔧 in the card's corner cluster, like the Houdini cards'. */
  onUtils?: () => void
  /** The character's original creation scene — gets a "primary" badge and is not
   *  unlinkable (the caller omits onRemove and passes onReplace instead). */
  primary?: boolean
  /** Selectable mode (see LinkedAssetCard): card click selects, icon opens. */
  selected?: boolean
  onSelect?: () => void
  /** Where the scene lives, shown under the title (a non-primary scene in a
   *  subfolder / linked in place — see `sceneLocationChip`). */
  pathChip?: ReactNode
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
          offsetY={offsetY}
          // h-[78px]: the PRIMARY label's bottom lands 2px ABOVE the avatar's
          // bottom edge (stack = title 24 + mt-1 4 + chip ~21 + gap-2 8 +
          // PRIMARY 19 ≈ 76, measured). Re-measure if the rows change.
          className="aspect-[3/4] h-[78px] shrink-0 rounded-md"
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
        primary || pathChip ? (
          // Stacked rows under the title: the path chip always second, the
          // PRIMARY label alone on the third. The chip is interactive (copy /
          // Alt-reveal / edit-to-move) — the card's extra block sits ABOVE the
          // cover button (LinkedAssetCard), so its clicks are its own and
          // never select/open the card. The chip's 1px offset is paint-only
          // (relative top) so the PRIMARY row below doesn't move with it.
          <span className="flex flex-col items-start gap-2">
            {pathChip && <span className="relative top-[1px]">{pathChip}</span>}
            {primary && (
              <PrimaryBadge
                dense
                title="The character's primary scene — it can't be unlinked; the folder button replaces it with another scene, while it is the only one linked"
              />
            )}
          </span>
        ) : undefined
      }
      altHeld={altHeld}
      openTitle="Open in Daz"
      accentClass="group-hover:text-daz-green"
      cardClass="daz-card"
      barClass="bg-daz-green"
      checkClass="bg-daz-green"
      onOpen={onOpen}
      onRename={onRename}
      onRemove={onRemove}
      removeTitle="Unlink from character"
      onReplace={onReplace}
      replaceDisabled={replaceDisabled}
      replaceTitle={replaceReason ?? 'Replace with another Daz scene…'}
      onUtils={onUtils}
      // "Scene utils", not "Utils": the accessible name is how tests (and
      // screen readers) tell this drawer's button apart from the Houdini
      // cards' "Utils — …" on the same page.
      utilsTitle="Scene utils — scans + hair export for this scene"
      selected={selected}
      onSelect={onSelect}
    />
  )
}

/**
 * The menu under a scene card's Open button: "Open scene" (the scene itself)
 * plus what the saved `rom-animations/<stem>_ROM.duf` allows.
 *
 * **A saved ROM animation is offered whenever the FILE is there** ("Open last
 * ROM"), current or not. It used to be swapped for the rebuild entry the moment
 * it read stale, which hid a perfectly openable file — and staleness here is
 * cheap to earn: the freshness test dates the generated ROM script, which every
 * character save rewrites, so editing anything at all makes every saved
 * animation of that character stale. Reported on exactly that: a primary scene
 * whose ROM had been built and exported, offering only to build it again (a
 * Daz run of many minutes) with no way to open what was already on disk.
 *
 * Stale does not mean wrong, it means "not from the current definition" — which
 * is the user's call, not the studio's, so the row opens anyway and its TOOLTIP
 * says so (it was an inline hint line once, dropped for making the menu wide).
 * "Generate new ROM" then sits under it: shown when the file is missing or
 * stale, and on Ctrl (force a rebuild of a current one — the save overwrites).
 * Closes on outside click / Escape.
 *
 * `generating` disables BOTH rom rows, not just the rebuild: a build in flight
 * OVERWRITES the very file the open row points at, and opening it would hand
 * the running Daz an `open-scene` job mid-build. The menu closes on the click
 * that starts a build, so this is the reopened-menu case — reachable, and now
 * reachable for a STALE animation too, which is the common one.
 */
function SceneOpenMenu({
  onOpenScene,
  onOpenRom,
  onGenerateRom,
  romExists,
  romStale,
  forceGenerate,
  generating,
  onClose,
}: {
  onOpenScene: () => void
  onOpenRom: () => void
  onGenerateRom: () => void
  /** A saved ROM animation is on disk for this scene. */
  romExists: boolean
  /** …but older than the scene file or the generated ROM script, so it was not
   *  built from what the character says now. Openable all the same. */
  romStale: boolean
  /** Offer the rebuild even for a current animation (Ctrl held). */
  forceGenerate: boolean
  generating: boolean
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  const item =
    'block w-full rounded-sm px-3 py-2 text-left text-sm font-medium hover:bg-daz-green/15 disabled:opacity-50 disabled:hover:bg-transparent'
  return (
    // `daz-card` (the scene cards' green tint + border — an opaque color-mix,
    // nothing shines through) makes the menu read as part of the card it
    // belongs to; the heavy shadow lifts it off the page.
    <div
      ref={ref}
      className="daz-card absolute right-1 top-full z-30 mt-1 w-max rounded-md border p-1 shadow-lg shadow-black/50"
    >
      <button type="button" className={item} onClick={onOpenScene}>
        Open scene
      </button>
      {romExists && (
        <button
          type="button"
          className={item}
          disabled={generating}
          title={
            generating
              ? 'A rebuild is running — it overwrites this file, so it opens once the build is done'
              : romStale
                ? 'Opens the ROM animation saved by an earlier run — it was not built from the current definition'
                : 'Opens the saved ROM animation — the built ROM, without the rebuild'
          }
          onClick={onOpenRom}
        >
          Open last ROM
        </button>
      )}
      {(!romExists || romStale || forceGenerate) && (
        <button
          type="button"
          className={item}
          disabled={generating}
          title="Opens the scene in Daz Studio, builds the ROM and saves it as the reopenable ROM animation"
          onClick={onGenerateRom}
        >
          {generating ? 'Generating ROM…' : 'Generate new ROM'}
        </button>
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
  onScenesRemoved,
  onRomRebuildStarted,
  dazProductsEnabled,
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
  /** Scenes the user just removed from the character, so folder detection stops
   *  offering them straight back (see `useDetectedFiles.answerFor`). Called for
   *  a plain unlink as well as a delete — in both the user has just said what
   *  that file is to this character. */
  onScenesRemoved?: (paths: Array<string>) => void
  /** A "Generate new ROM" handoff went out — the page drops the findings of the
   *  scenes it retired from the last run report (the handoff already retired
   *  them on disk), so their red rows can't outlive the run that produced them.
   *  Always the ONE rebuilt scene here: the rebuild re-runs one scene and
   *  supersedes nothing else. An array because it is the same "these scenes are
   *  history" signal the DTH Export handoff sends for its whole selection. */
  onRomRebuildStarted?: (scenePaths: ReadonlyArray<string>) => void
  /** The project's "Daz Products" opt-in — threaded into the scene Utils drawer
   *  so its product-scan button can explain itself instead of failing. */
  dazProductsEnabled: boolean
}) {
  const [busy, setBusy] = useState(false)
  // The scene whose Utils drawer is open ('' = closed) — the path IS the scope,
  // like the Houdini cards' drawer.
  const [utilsFor, setUtilsFor] = useState('')
  const [error, setError] = useState('')
  // A scene click while Daz is already running: the studio can't switch a running
  // Daz's scene, so this holds the clicked scene path to drive the warning dialog.
  const [dazWarn, setDazWarn] = useState<string | null>(null)
  // Polled while that dialog is up. Opening into a running Daz never works, so the
  // dialog tells the user to close Daz; once it's closed this flips false and the
  // button becomes "Open now" (which launches a fresh Daz with the scene).
  const [dazStillRunning, setDazStillRunning] = useState(true)
  // A picked scene outside the project pauses here awaiting the copy decision.
  // The primary always lands in its own "primary" subfolder below the scenes
  // root — its export nests under that name (see lib/scene-subfolder.ts).
  const [pending, setPending] = useState('')
  const [subfolder, setSubfolder] = useState(() => `${defaultSubdir}/${PRIMARY_SCENE_SUBFOLDER}`)
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
  // Every scene the PROJECT's characters link (fetched when the add dialog
  // opens; null while loading) — feeds the "Not already linked" HARD check.
  const [addOwners, setAddOwners] = useState<Array<{
    path: string
    character: string
    characterId: string
  }> | null>(null)
  const [forceAdd, setForceAdd] = useState(false)
  // Supersede stale reads (repick before the previous read resolved).
  const addScanId = useRef(0)
  // When on, the source scene is deleted after copying (a move). Off by default;
  // mutually exclusive with "Link in place" (which keeps the original in place).
  const [deleteOriginal, setDeleteOriginal] = useState(false)
  // A scene pending the unlink confirm + whether to also delete it from disk.
  const [pendingRemove, setPendingRemove] = useState('')
  const [removeDeleteFile, setRemoveDeleteFile] = useState(false)
  // The Add-scene dialog machinery doubles as the primary's REPLACE flow: same
  // validation, same copy-vs-link decision — but the confirm swaps `scenePath`
  // instead of appending an extra. The OLD primary's files are ALWAYS cleaned
  // up when they are an in-folder copy (replacing means replacing — no toggle);
  // a linked-in-place original is the user's file and is only ever unlinked.
  const [replaceMode, setReplaceMode] = useState(false)
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
  const cleanSub = (s: string) => s.split(/[\\/]+/).filter(Boolean).join('/')
  const primaryDir = character.scenePath ? parentDir(character.scenePath) : ''
  const primaryDirRel =
    primaryDir && primaryDir.toLowerCase().startsWith(charFolder.toLowerCase() + '/')
      ? primaryDir.slice(charFolder.length + 1)
      : ''
  // The scenes ROOT (the character's "Daz scenes main folder") — ONE shared
  // rule (lib/scene-subfolder.ts): the project's configured subdir when the
  // primary sits under it, else the primary's folder with its own "primary"
  // subfolder segment stripped (a renamed root), else the primary's folder
  // itself (legacy layout).
  const scenesRootRel = deriveScenesRootRel(primaryDirRel, defaultSubdir)
  const baseDazRel = scenesRootRel || defaultSubdir
  // The per-scene EXPORT subfolders (the same rule generation uses), for the
  // removal flows: a deleted/replaced scene's export folder goes with it —
  // sceneDeleteTargets guards WHEN that is safe. Keyed like the map itself
  // (normalized + lowercased).
  const scenesRootAbs = [charFolder, scenesRootRel].filter(Boolean).join('/')
  const exportSubfolderMap = sceneExportSubfolders(character, scenesRootAbs)
  const exportKeyOf = (p: string) => p.trim().replace(/\\/g, '/').toLowerCase()

  // ── Open-in-Daz dropdown: the scene vs its saved ROM animation ──────────
  // The card's open button shows a menu (Alt+click keeps the direct Explorer
  // reveal): "Open scene", the scene's saved `rom-animations/<stem>_ROM.duf`
  // WHENEVER THAT FILE EXISTS (marked when it predates the current definition —
  // see SceneOpenMenu for why that is not a reason to hide it), and "Open and
  // Generate ROM Animation" when there is none, the saved one is stale, or Ctrl
  // is held: a one-row Runner batch on the hidden ROM-only script, then the
  // fresh file opens by itself.
  //
  // Both facts come from `fetchRomAnimations` — file mtimes, no stamps, so a
  // focus re-read always tells the truth.
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [romReadySet, setRomReadySet] = useState<ReadonlySet<string>>(new Set())
  /** Scenes with a saved ROM animation ON DISK, current or not — `romReadySet`
   *  is the subset built from what the character says now. */
  const [romExistsSet, setRomExistsSet] = useState<ReadonlySet<string>>(new Set())
  /** The two menu facts for one scene, derived in ONE place: the primary card
   *  and every extra render the same menu, so a hand-written expression per
   *  card is how they drift apart. */
  function romMenuState(scene: string): { exists: boolean; stale: boolean } {
    const exists = romExistsSet.has(scene)
    return { exists, stale: exists && !romReadySet.has(scene) }
  }
  const [generatingRom, setGeneratingRom] = useState('')
  // The ROM handoff found several Daz Studios open — a dialog, not a toast,
  // since the user has to go close one first (see MultipleDazModal).
  const [multiDaz, setMultiDaz] = useState(false)
  // onGenerateRom's poll can run for up to 30 minutes — without a cancellation
  // flag it outlives this component and auto-opens the ROM scene in Daz long
  // after the user navigated away. Cleared on unmount (and re-armed on mount,
  // so StrictMode's mount-cleanup-mount doesn't leave it stuck false).
  const romPollAlive = useRef(true)
  useEffect(() => {
    romPollAlive.current = true
    return () => {
      romPollAlive.current = false
    }
  }, [])
  const ctrlHeld = useModifierHeld('Control')
  const romScenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const romScenesKey = romScenes.join('|')
  useRefetchOnFocus(
    () => {
      void fetchRomAnimations({ data: { projectId, id: character.id } })
        .then((status) => {
          setRomReadySet(new Set(status.filter((s) => s.current).map((s) => s.scenePath)))
          setRomExistsSet(new Set(status.filter((s) => s.exists).map((s) => s.scenePath)))
        })
        // Best-effort: an unreadable project share leaves the last answer in
        // place (worst case one needless rebuild), never an unhandled rejection.
        .catch(() => {})
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [romScenesKey],
    { immediate: true },
  )

  function onOpenClick(scenePath: string, e?: React.MouseEvent) {
    if (e?.altKey) {
      void onOpen(scenePath, e) // the reveal shortcut stays direct
      return
    }
    setMenuFor((current) => (current === scenePath ? null : scenePath))
  }

  async function onGenerateRom(scene: string) {
    setMenuFor(null)
    setGeneratingRom(scene)
    try {
      const { romPath, dazWasRunning, startedAt } = await generateRomAnimation({
        data: { projectId, id: character.id, scenePath: scene },
      })
      // The handoff is out and this scene is being rebuilt — its verdict from
      // the last run is history (and already gone from disk). Only this one:
      // every other scene's findings still stand.
      onRomRebuildStarted?.([scene])
      toast.success(
        dazWasRunning
          ? 'Daz Studio is building the ROM animation — it opens by itself once saved.'
          : 'Started Daz Studio — the ROM animation opens by itself once saved.',
      )
      // Freshness (mtime ≥ handoff), not existence: a regenerate OVERWRITES.
      const deadline = Date.now() + 30 * 60_000
      /* oxlint-disable no-await-in-loop -- a POLL, not an iteration: sleep, ask
         whether Daz has written the ROM animation yet, stop as soon as it has.
         Every await here is waiting for the PREVIOUS one to have happened. */
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 3000))
        // Unmounted (navigated away, character switched) — stop silently; Daz
        // finishes its run either way, and the auto-open must not fire later.
        if (!romPollAlive.current) return
        if (await romAnimationFresh({ data: { romPath, sinceMs: startedAt } })) {
          // Just built from the current definition — ready without waiting for
          // the next focus re-read.
          setRomReadySet((prev) => new Set(prev).add(scene))
          setRomExistsSet((prev) => new Set(prev).add(scene))
          await onOpen(romPath)
          return
        }
      }
      /* oxlint-enable no-await-in-loop */
      toast.warning('The ROM animation never appeared — check the run in Daz Studio.')
    } catch (err) {
      if (err instanceof MultipleDazInstancesError) setMultiDaz(true)
      else toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setGeneratingRom('')
    }
  }

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
      // The studio can't switch the scene of an already-running Daz itself (a
      // forwarded open is dropped once a scene is loaded) — but the Runner
      // plugin, living inside Daz, can: hand it an `open-scene` job, which also
      // raises the Daz window. A Runner too old to know the job type leaves the
      // file alone; that non-pickup is the signal to fall back to the dialog
      // (which waits for the user to close Daz). With Daz closed, opening
      // launches it fresh, which has always worked.
      if (await dazStudioRunning()) {
        // The handshake waits out one of the Runner's poll intervals, so it can
        // take a few seconds — say so rather than leaving the click silent.
        const handing = toast.loading('Handing the scene to Daz Studio…')
        try {
          const { pickedUp } = await openSceneInRunningDaz({ data: { scenePath } })
          if (pickedUp) {
            toast.success('Opening the scene in Daz Studio…', { id: handing })
            return
          }
          toast.dismiss(handing)
        } catch (err) {
          toast.dismiss(handing)
          throw err
        }
        // No pickup. A "running" Daz that ignored the handoff is often one
        // that was CLOSING when we looked (the process lingers a while after
        // close) — if it is gone by now, just launch fresh instead of showing
        // the "close Daz first" dialog for a Daz that already closed.
        if (!(await dazStudioRunning())) {
          await openScene({ data: { scenePath } })
          return
        }
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
  function startAdd(picked: string, replace = false) {
    // Every scene gets its OWN subfolder now: a replacement primary goes to
    // "primary", an extra scene is seeded from its sanitized filename (the
    // character name + generation/preset noise stripped) — editable, never empty.
    setAddSubfolder(
      replace ? PRIMARY_SCENE_SUBFOLDER : suggestSceneSubfolder(picked, character.name),
    )
    setDeleteOriginal(false)
    setForceAdd(false)
    setAddScan(null)
    setAddOwners(null)
    setReplaceMode(replace)
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
    // The "Not already linked" check's reference: the OTHER characters' linked
    // scenes from a fresh library walk (this character's own come from the
    // live draft at render time). A failed walk just leaves the row unchecked.
    void fetchCharactersWithProblems({ data: { projectId } })
      .then(({ characters }) => {
        if (scanId !== addScanId.current) return
        setAddOwners(charactersLinkedScenes(characters.filter((c) => c.id !== character.id)))
      })
      // A failed walk must not leave the dialog on "checking…" forever — an
      // empty reference just means the cross-character check can't verify
      // (this character's own scenes still come from the live draft).
      .catch(() => {
        if (scanId === addScanId.current) setAddOwners([])
      })
  }

  /** Where the scene pickers open: the folder the primary scene lives in (an
   *  outfit variant is nearly always saved beside it), else the character
   *  folder. Not the primary FILE — preselecting the scene you are replacing or
   *  adding a sibling to is noise. */
  const scenePickFrom = browseStart(primaryDir, charFolder)

  async function onAddPick() {
    const picked = await pickDufPath('Select another Daz scene (.duf)', scenePickFrom)
    if (!picked) return
    startAdd(picked)
  }

  /**
   * Replacing the primary is only offered while it is the character's ONLY
   * scene.
   *
   * Every extra scene was validated against the CURRENT primary when it was
   * added — same Genesis, one figure, empty timeline, and above all the same
   * GP/DK geograft, because every scene has to produce the primary's skeleton.
   * Swapping the primary out from under them re-decides exactly that reference:
   * a replacement without Golden Palace turns a whole set of validated extras
   * into silently mismatched ones, and nothing would re-check them. There is no
   * good automatic answer (re-validating and unlinking the failures behind the
   * user's back is worse), so the user unlinks first and re-adds against the new
   * primary, which runs the real validation for each one.
   */
  const replaceBlocked = character.extraScenes.length > 0
  // Two full variants, not spliced plurals — "they were/it was" has to agree
  // too. "Keeping its file" = leave the Remove dialog's "Delete file on disk"
  // toggle off (its default), so the scene can be re-added afterwards.
  const replaceReason = replaceBlocked
    ? character.extraScenes.length === 1
      ? "Unlink the other scene first, keeping its file so it can be re-added — it was validated against this primary's GP/DK geograft, and a different primary would leave it mismatched"
      : "Unlink the other scenes first, keeping their files so they can be re-added — they were validated against this primary's GP/DK geograft, and a different primary would leave them mismatched"
    : undefined

  async function onReplacePick() {
    // Backstop for the disabled button (a stale render, a keyboard path): the
    // rule lives here too, not only in the control that offers it.
    if (replaceBlocked) {
      toast.error(replaceReason ?? 'Unlink the character’s other scenes first.')
      return
    }
    const picked = await pickDufPath('Select the NEW primary Daz scene (.duf)', scenePickFrom)
    if (!picked) return
    startAdd(picked, true)
  }

  /** Swap the primary for `scene` — the Add flow's copy/link mechanics, but the
   *  patch REPLACES `scenePath` (extras stay), the new primary re-derives the
   *  GEN section like a relink (gender stays baked), the persist runs through
   *  relinkScene so the avatar follows, and the OLD primary (in-folder copies
   *  only) is cleaned up like a deleted scene: its whole subfolder when the
   *  replacement vacated it, else its files plus its own saved ROM animation
   *  (sceneDeleteTargets — the same decision the remove flow makes). */
  async function applyReplace(scene: string, copyInto: boolean) {
    // The last gate before anything is written — the dialog can outlive the
    // state that opened it (a scene added in another window, a focus refetch).
    if (character.extraScenes.length > 0) {
      toast.error(replaceReason ?? 'Unlink the character’s other scenes first.')
      return
    }
    const sceneName = scene.split(/[\\/]/).pop() ?? scene
    // Every copied-in scene needs its OWN subfolder below the scenes root (the
    // dialog disables Copy on empty — this is the backstop).
    if (copyInto && cleanSub(addSubfolder) === '') {
      toast.error('Enter a subfolder — every scene lives in its own subfolder now.')
      return
    }
    const reserved = sceneSubfolderConflict(addSubfolder)
    if (copyInto && reserved) {
      toast.error(reserved)
      return
    }
    const destSubfolder = [baseDazRel, cleanSub(addSubfolder)].filter(Boolean).join('/')
    const oldPrimary = character.scenePath
    // Same up-front duplicate refusal as applyAdd — including the old primary
    // itself: a same-named copy would overwrite the old file, and the delete
    // below would then remove the just-copied replacement.
    const dest = copyInto ? [charFolder, destSubfolder, sceneName].filter(Boolean).join('/') : scene
    if (isAlreadyLinked(dest)) {
      toast.error(`“${sceneName}” is already linked to this character.`)
      return
    }
    setBusy(true)
    setError('')
    // The ACTUAL new primary path, captured from the producer for the old-file
    // cleanup below — `dest` predicts it, but the copy is the authority.
    let newPrimary = ''
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
        newPrimary = finalScene
        const patch: Partial<Character> = {
          scenePath: finalScene,
          extraScenes: extrasWithoutPrimary(character.extraScenes, finalScene),
        }
        // The NEW primary decides the GEN section — the same rule as a relink
        // (`primarySceneDerivation`); gender stays baked, like every non-first
        // link. Unreadable scene → keep the stored values.
        const scan = await sceneWearables({ data: { scenePath: finalScene } })
        const derived = primarySceneDerivation(scan, character)
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
        // …and pre-selects its own hair, the one shared rule (`seedSceneHair`),
        // exactly like creation, the first primary link and an added scene. A
        // REPLACEMENT is a different scene with different hair: without this the
        // new primary arrived with an empty hair list, and hair the studio is
        // meant to keep out rode straight into the FBX. The old primary's record
        // is left alone — it is inert once its scene is gone
        // (`activeSceneOverrides`), and a curated list is never clobbered.
        const seeded = seedSceneHair(finalScene, scan, character.sceneOverrides)
        if (seeded) patch.sceneOverrides = seeded
        return patch
      },
      {
        toast: 'Replaced the primary Daz scene',
        // relinkScene persists AND re-derives the avatar from the new primary.
        persist: (updated) =>
          relinkScene({ data: { projectId, character: updated, scenePath: updated.scenePath } }),
      },
    )
    if (saved) {
      setPendingAdd('')
      // Persist FIRST, delete after (the remove flow's order) — a failed save
      // must never leave the character pointing at already-deleted files.
      if (oldPrimary && insideCharFolder(oldPrimary)) {
        try {
          // Same decision as the remove flow: the old primary's whole subfolder
          // when the replacement VACATED it (saved ROM animations included),
          // else its files plus its own rom-animations/<stem>_ROM.duf — which
          // used to be left behind as a stale save either way. Its export
          // folder goes too, UNLESS the new link set claims the same one (a
          // replacement into the same subfolder keeps the folder it is about
          // to export into) — hence the post-replace map below. The new
          // primary is in `remainingScenesAbs`, so a replacement copied into
          // the SAME folder blocks the scene-folder branch by construction.
          const newLinked = [newPrimary || dest, ...character.extraScenes]
          const newExportMap = sceneExportSubfolders(
            { ...character, scenePath: newPrimary || dest },
            scenesRootAbs,
          )
          const targets = sceneDeleteTargets({
            sceneAbs: oldPrimary,
            charFolderAbs: charFolder,
            scenesRootRel,
            remainingScenesAbs: newLinked,
            exportRootAbs: character.exportPath,
            exportSubfolderRel: exportSubfolderMap[exportKeyOf(oldPrimary)] ?? '',
            remainingExportSubfoldersRel: newLinked
              .map((s) => newExportMap[exportKeyOf(s)] ?? '')
              .filter(Boolean),
          })
          await deleteFiles({ data: { paths: targets.files, folders: targets.folders } })
        } catch (e) {
          toast.warning(
            `Replaced, but couldn't delete the old scene files: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
    }
    setBusy(false)
  }

  async function applyAdd(scene: string, copyInto: boolean) {
    const sceneName = scene.split(/[\\/]/).pop() ?? scene
    // See applyReplace — a copied-in scene can't land directly in the root.
    if (copyInto && cleanSub(addSubfolder) === '') {
      toast.error('Enter a subfolder — every scene lives in its own subfolder now.')
      return
    }
    const reservedAdd = sceneSubfolderConflict(addSubfolder)
    if (copyInto && reservedAdd) {
      toast.error(reservedAdd)
      return
    }
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
        // Append + pre-select the scene's own hair — the shared builder
        // (lib/scene-add.ts), same rules as the detected-files wizard.
        return addScenePatch(finalScene, character)
      },
      { toast: 'Added Daz scene' },
    )
    if (saved) setPendingAdd('')
    setBusy(false)
  }

  async function onPick() {
    // Relinking a MISSING primary: its old folder is still the best guess (the
    // file usually moved within the character), then the character folder.
    const picked = await pickDufPath('Select the Daz character scene (.duf)', scenePickFrom)
    if (!picked) return
    if (!insideProject(picked)) {
      setSubfolder(`${defaultSubdir}/${PRIMARY_SCENE_SUBFOLDER}`)
      setPending(picked)
      return
    }
    await applyLink(picked, false)
  }

  async function applyLink(scene: string, copyInto: boolean) {
    setBusy(true)
    setError('')
    // The very FIRST primary link (a character created without a scene — the
    // locked editor) completes what creation couldn't derive; a RELINK (only
    // reachable for a MISSING primary) is narrower — see below.
    const firstLink = !character.scenePath
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
        // GEN/gender/genesis derivation + hair rules live in the shared builder
        // (lib/scene-add.ts) — the same rules the detected-files wizard links by.
        return primaryLinkPatch(finalScene, character, firstLink, (m) => toast.info(m))
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
        setSubfolder(`${defaultSubdir}/${PRIMARY_SCENE_SUBFOLDER}`)
        setPending(scene)
        return
      }
      void applyLink(scene, false)
    } else {
      startAdd(scene)
    }
  }

  // Open the unlink confirm. "Delete file on disk" always starts OFF — deleting
  // is opt-in per removal (the confirm button flips Unlink → Delete when it's
  // on). It used to pre-tick for an in-folder scene, but an in-folder scene can
  // be the ONLY copy (Add scene's "delete the original" MOVES it in), the
  // delete is permanent (no recycle bin), and unlink-then-re-add is the
  // documented route around the replace-primary gate — a pre-ticked delete
  // destroys exactly the file the user means to keep. A linked-in-place scene
  // additionally locks the toggle off entirely (deleteFileDisabled below).
  /** A card drag dropped somewhere new — persist the extra scenes' new order
   *  (the cards render in array order; the primary stays first, unsortable). */
  function onReorderScenes(next: Array<string>) {
    void persistPatch({ extraScenes: next }, { toast: 'Scene order saved' })
  }

  function askRemove(scene: string) {
    setError('')
    // Unconditionally OFF — the whole why lives in the comment above. (This
    // used to follow WHERE the file is, pre-ticking delete for an in-folder
    // scene, directly contradicting it.)
    setRemoveDeleteFile(false)
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
      // Before the delete below, and before anything awaits: persisting the
      // unlink is itself what re-runs folder detection, so the scene has to be
      // answered for by the time that scan lands or it comes straight back as a
      // "new file" — the file is still on disk either way at this point.
      onScenesRemoved?.([scene])
      if (removeDeleteFile) {
        try {
          // The scene's own subfolder (rom-animations included) when it has one
          // to itself, else its files plus its own saved ROM animation — and in
          // both modes its export folder; see sceneDeleteTargets. `remaining`
          // is the post-unlink link set, so a folder (scene or export) another
          // linked scene uses is never deleted.
          const targets = sceneDeleteTargets({
            sceneAbs: scene,
            charFolderAbs: charFolder,
            scenesRootRel,
            remainingScenesAbs: remaining,
            exportRootAbs: character.exportPath,
            exportSubfolderRel: exportSubfolderMap[exportKeyOf(scene)] ?? '',
            remainingExportSubfoldersRel: remaining
              .map((s) => exportSubfolderMap[exportKeyOf(s)] ?? '')
              .filter(Boolean),
          })
          await deleteFiles({ data: { paths: targets.files, folders: targets.folders } })
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
  const addRows = [
    ...sceneCompatRows({
      scan: addScan?.scene ?? null,
      primaryScan: addScan?.primary ?? null,
      character,
    }),
    // The picked scene must not already belong to a character — the other
    // characters' scenes come from the dialog-open walk (addOwners), this
    // character's own from the live draft. A hit is a HARD fail (no escape).
    ...(pendingAdd
      ? [
          sceneNotLinkedRow(
            pendingAdd,
            addOwners === null
              ? null
              : [
                  ...addOwners,
                  ...linkedScenes.map((path) => ({
                    path,
                    character: character.name,
                    characterId: character.id,
                  })),
                ],
          ),
        ]
      : []),
  ]
  const addChecking = pendingAdd !== '' && (addScan === null || addOwners === null)
  const addHardBlocked = sceneCompatHardFailed(addRows)
  const addBlocked =
    addChecking || addHardBlocked || (sceneCompatFailed(addRows) && !forceAdd)
  const addValidation = (
    <SceneValidationTable
      rows={addRows}
      loading={addChecking}
      force={forceAdd}
      onForceChange={setForceAdd}
      forceLabel={`${replaceMode ? 'Replace' : 'Add'} anyway — a failed check usually means the scene's ROM won't match`}
      projectId={projectId}
      // A scene already linked to THIS character gets no owner link — it would
      // just point at the page the dialog is open on.
      currentCharacterId={character.id}
    />
  )
  const addBlockedTitle = addChecking
    ? 'Checking the scene…'
    : addHardBlocked
      ? 'This scene already belongs to a character — pick a different scene'
      : `A validation check failed — see the table above (or flip “${replaceMode ? 'Replace' : 'Add'} anyway”)`
  // The replace flow's old-file handling needs no controls: an in-folder old
  // primary is "ours" (a copy) and is always cleaned up — replacing means
  // replacing. Only the linked-in-place case gets a notice (the user's
  // original is only ever unlinked, never touched).
  const replaceOldBlock =
    replaceMode && !insideCharFolder(character.scenePath) ? (
      <p className="text-xs text-muted-foreground">
        The old primary is linked in place — your original file is kept.
      </p>
    ) : null

  // What "Delete file on disk" will actually remove for the scene pending
  // removal — drives the remove dialog's copy: a scene with a subfolder of its
  // own loses the whole folder (saved ROM animations included), a shared-folder
  // scene its files plus its own saved ROM animation; the scene's export
  // folder goes in both modes when it has one to itself. Must mirror
  // confirmRemove's sceneDeleteTargets call, so the dialog never promises less
  // than the delete does.
  const removePendingRemaining = linkedScenes.filter((s) => s !== pendingRemove)
  const removeTargetsPreview =
    pendingRemove !== ''
      ? sceneDeleteTargets({
          sceneAbs: pendingRemove,
          charFolderAbs: charFolder,
          scenesRootRel,
          remainingScenesAbs: removePendingRemaining,
          exportRootAbs: character.exportPath,
          exportSubfolderRel: exportSubfolderMap[exportKeyOf(pendingRemove)] ?? '',
          remainingExportSubfoldersRel: removePendingRemaining
            .map((s) => exportSubfolderMap[exportKeyOf(s)] ?? '')
            .filter(Boolean),
        })
      : null
  // "Deleting also removes …" — assembled from what the delete will take.
  const removeDeleteExplainer = removeTargetsPreview
    ? ` Deleting also removes ${[
        removeTargetsPreview.sceneFolder
          ? 'the scene’s folder (saved ROM animations included)'
          : 'its saved ROM animation',
        ...(removeTargetsPreview.exportFolder ? ['its Daz export folder'] : []),
      ].join(' and ')}.`
    : ''

  // Two-tone path chip for the scenes ROOT: everything through the CHARACTER
  // folder is dimmed — we're already inside the character here, so only the
  // scenes root ("\daz3d") reads bright. The root, NOT the primary's own
  // folder — the primary may sit in a subfolder of it. A primary linked from
  // outside the character folder falls back to its full directory.
  const sceneDirRel = scenesRootRel
  const sceneDir = sceneDirRel
    ? displayPath(`${charFolder}/${sceneDirRel}`)
    : displayDirOf(character.scenePath)
  // Edit-to-move via the shared floating panel (FolderMoveChip) — moving the
  // root physically moves the whole folder; editable only for an in-folder root.
  const sceneDirChip = sceneDirRel ? (
    <FolderMoveChip
      dir={sceneDir}
      roots={[displayPath(charFolder), displayPath(location.libraryFolder)]}
      editValue={displayPath(sceneDirRel)}
      editLabel="Scenes subfolder"
      onMove={moveScenesRoot}
      disabled={busy}
    />
  ) : (
    <DirPathChip dir={sceneDir} roots={[displayPath(charFolder), displayPath(location.libraryFolder)]} />
  )

  /** Where a scene lives — EVERY card shows its chip: relative to the
   *  character folder (e.g. `.\daz3d\Outfit_B`) for an in-folder scene, the
   *  full folder for one linked in place; copying always yields the full
   *  folder path. In-folder chips are EDIT-TO-MOVE — the PRIMARY exactly like
   *  any other scene: the scenes root shows as a fixed prefix, only the
   *  subfolder beyond it is editable, and an EMPTY input means "directly in
   *  the root". A linked-in-place chip stays read-only. */
  function sceneLocationChip(scene: string): ReactNode {
    const dir = parentDir(scene)
    const inside = insideCharFolder(scene)
    const rel = inside ? normalizePath(dir).slice(charFolder.length + 1) : ''
    const shown = displayPath(inside ? `./${rel}` : dir)
    // Two-tone (same look + height as every small path chip): the part
    // matching the scenes root (`.\daz3d`) is DIM — a root-dwelling scene's
    // chip is all root, so all dim — and only what goes beyond it reads
    // bright. Scenes elsewhere fall back to the last-separator split.
    const cut = Math.max(shown.lastIndexOf('\\'), shown.lastIndexOf('/'))
    const scenesRootShown = sceneDirRel ? displayPath(`./${sceneDirRel}`) : ''
    const roots = [scenesRootShown, cut > 0 ? shown.slice(0, cut) : ''].filter(Boolean)
    if (!inside) return <DirPathChip dir={shown} roots={roots} copyPath={displayPath(dir)} />
    // The scenes-root prefix stays fixed (the root itself moves via the
    // section chip above the cards). An EMPTY input is refused: every scene
    // lives in its own subfolder now (the export nests under its name), so a
    // scene can't sit directly in the scenes root anymore.
    const rootLower = sceneDirRel.toLowerCase()
    const underRoot =
      sceneDirRel !== '' &&
      (rel.toLowerCase() === rootLower || rel.toLowerCase().startsWith(`${rootLower}/`))
    const beyond = underRoot ? rel.slice(sceneDirRel.length).replace(/^\//, '') : ''
    return (
      <FolderMoveChip
        dir={shown}
        roots={roots}
        copyPath={displayPath(dir)}
        editValue={displayPath(underRoot ? beyond : rel)}
        editPrefix={underRoot ? displayPath(`./${sceneDirRel}/`) : undefined}
        editLabel="Move to"
        inputWidthClass="w-36"
        onMove={async (next) => {
          if (cleanSub(next) === '') {
            throw new Error(
              'Every scene lives in its own subfolder now — it can no longer sit directly in the scenes root.',
            )
          }
          // Only when moving WITHIN the scenes root does a name collide with the
          // studio's own folders; an absolute move out of the root can't.
          const reserved = underRoot ? sceneSubfolderConflict(next) : ''
          if (reserved) throw new Error(reserved)
          await moveLinkedScene(
            scene,
            underRoot ? [sceneDirRel, cleanSub(next)].filter(Boolean).join('/') : next,
          )
        }}
        disabled={busy}
      />
    )
  }

  /** Move the WHOLE scenes folder to `newSubdir` (relative to the character
   *  folder) — shared by the section chip's inline editor and the primary
   *  card's chip. Throws on failure (each caller owns its error surface). */
  async function moveScenesRoot(newSubdir: string): Promise<void> {
    setBusy(true)
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
      }
    } finally {
      setBusy(false)
    }
  }

  /** Move ONE extra scene to `nextSub` (relative to the character folder) —
   *  the card chip's editor. Copies + deletes the original (a move), then
   *  persists the repointed scene path and its per-scene record. The PRIMARY
   *  moves exactly the same way — its `scenePath` (and the avatar's
   *  `imageScene`, when it points at it) repoint instead of `extraScenes`. */
  async function moveLinkedScene(scene: string, nextSub: string): Promise<void> {
    const sceneName = scene.split(/[\\/]/).pop() ?? scene
    const dest = [charFolder, cleanSub(nextSub), sceneName].filter(Boolean).join('/')
    if (normalizePath(dest).toLowerCase() === normalizePath(scene).toLowerCase()) return
    if (isAlreadyLinked(dest)) throw new Error(`“${sceneName}” is already linked from there.`)
    setBusy(true)
    try {
      const moved = await copyDazScene({
        data: {
          projectId,
          characterId: character.id,
          scenePath: scene,
          subfolder: cleanSub(nextSub),
          deleteOriginal: true,
        },
      })
      await repointLinkedScene(scene, moved, `Moved “${sceneName}”`)
    } finally {
      setBusy(false)
    }
  }

  /** Persist a linked scene's NEW path everywhere it appears — scenePath (+
   *  the avatar's imageScene) for the primary, extraScenes otherwise, and the
   *  per-scene records either way. The persist regenerates the scripts, so
   *  the generated `.dsa`/CSVs pick the new path/name up immediately. */
  async function repointLinkedScene(scene: string, moved: string, toastMsg: string): Promise<void> {
    const target = normalizePath(scene).toLowerCase()
    const repoint = (p: string) => (normalizePath(p).toLowerCase() === target ? moved : p)
    const isPrimary = normalizePath(character.scenePath).toLowerCase() === target
    await persistPatch(
      {
        ...(isPrimary
          ? { scenePath: moved }
          : { extraScenes: character.extraScenes.map(repoint) }),
        // The avatar's provenance follows its scene through a rename/move — for
        // EXTRA scenes too (the avatar can be snapshotted from any linked
        // scene), or the sync would see the old path as gone and re-derive
        // from the primary.
        ...(character.imageScene && normalizePath(character.imageScene).toLowerCase() === target
          ? { imageScene: moved }
          : {}),
        sceneOverrides: character.sceneOverrides.map((o) => ({
          ...o,
          scenePath: repoint(o.scenePath),
        })),
      },
      { toast: toastMsg, rethrow: true },
    )
    // Keep the selection on the moved/renamed card (its path just changed).
    if (selectedScene === scene) onSelectScene?.(moved)
  }

  /** Rename a linked scene's FILES in place (`.duf` + both thumbnail
   *  sidecars), then repoint — the card title's inline rename. */
  async function renameLinkedScene(scene: string, nextName: string): Promise<void> {
    const clean = nextName.trim()
    if (!clean) return
    const dest = `${parentDir(scene)}/${clean}.duf`
    if (normalizePath(dest).toLowerCase() === normalizePath(scene).toLowerCase()) return
    if (isAlreadyLinked(dest)) throw new Error(`“${clean}.duf” is already linked.`)
    setBusy(true)
    try {
      const moved = await renameDazScene({ data: { scenePath: scene, newName: clean } })
      await repointLinkedScene(scene, moved, `Renamed to “${clean}”`)
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
      <Label id="daz-scenes" className="mb-3 flex w-fit scroll-mt-28 items-center gap-1 text-xl font-semibold">
        Daz scenes
        <InfoPopup label="Daz scenes — more information">
          The character's linked scenes — the primary plus any outfit or hair variants.{' '}
          <GuideLink href="https://polynaut.github.io/dth-character-studio/guide/advanced.html#multiple-daz-scenes--outfits-amp-hair-variants">
            Open guide
          </GuideLink>
        </InfoPopup>
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
                pencil opens the floating move editor: the new subfolder
                (relative to the character folder) physically moves the folder
                on disk and repoints every linked scene. A div, not a <p> — the
                floating panel is a div, invalid inside a paragraph. */}
            <div className="mb-2 text-xs">{sceneDirChip}</div>
            <CardReorderContext ids={character.extraScenes} onReorder={onReorderScenes}>
              <div ref={cardsRef} className="flex flex-wrap items-stretch gap-3">
                {ready ? (
                  <div className="relative">
                    <SceneCard
                      scenePath={character.scenePath}
                      name={character.name}
                      offsetY={character.imageOffsetY}
                      onOpen={(e) => onOpenClick(character.scenePath, e)}
                      onRename={
                        insideCharFolder(character.scenePath)
                          ? (next) => renameLinkedScene(character.scenePath, next)
                          : undefined
                      }
                      onReplace={busy ? undefined : () => void onReplacePick()}
                      replaceDisabled={replaceBlocked}
                      replaceReason={replaceReason}
                      onUtils={() => setUtilsFor(character.scenePath)}
                      primary
                      selected={selectedScene !== undefined ? selectedScene === character.scenePath : undefined}
                      onSelect={onSelectScene ? () => onSelectScene(character.scenePath) : undefined}
                      pathChip={sceneLocationChip(character.scenePath)}
                    />
                    {menuFor === character.scenePath && (
                      <SceneOpenMenu
                        onOpenScene={() => {
                          setMenuFor(null)
                          void onOpen(character.scenePath)
                        }}
                        onOpenRom={() => {
                          setMenuFor(null)
                          void onOpen(romAnimationPath(character.scenePath))
                        }}
                        onGenerateRom={() => void onGenerateRom(character.scenePath)}
                        romExists={romMenuState(character.scenePath).exists}
                        romStale={romMenuState(character.scenePath).stale}
                        forceGenerate={ctrlHeld}
                        generating={generatingRom === character.scenePath}
                        onClose={() => setMenuFor(null)}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-dashed border-destructive/50 p-3 py-8 text-sm text-muted-foreground">
                    Primary scene missing.
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void onPick()}>
                      <Link2 /> Relink
                    </Button>
                  </div>
                )}
                {character.extraScenes.map((scene) => (
                  <SortableCard key={scene} id={scene}>
                    <SceneCard
                      scenePath={scene}
                      name={character.name}
                      offsetY={character.imageOffsetY}
                      onOpen={(e) => onOpenClick(scene, e)}
                      onRename={
                        insideCharFolder(scene) ? (next) => renameLinkedScene(scene, next) : undefined
                      }
                      onRemove={() => askRemove(scene)}
                      onUtils={() => setUtilsFor(scene)}
                      selected={selectedScene !== undefined ? selectedScene === scene : undefined}
                      onSelect={onSelectScene ? () => onSelectScene(scene) : undefined}
                      pathChip={sceneLocationChip(scene)}
                    />
                    {menuFor === scene && (
                      <SceneOpenMenu
                        onOpenScene={() => {
                          setMenuFor(null)
                          void onOpen(scene)
                        }}
                        onOpenRom={() => {
                          setMenuFor(null)
                          void onOpen(romAnimationPath(scene))
                        }}
                        onGenerateRom={() => void onGenerateRom(scene)}
                        romExists={romMenuState(scene).exists}
                        romStale={romMenuState(scene).stale}
                        forceGenerate={ctrlHeld}
                        generating={generatingRom === scene}
                        onClose={() => setMenuFor(null)}
                      />
                    )}
                  </SortableCard>
                ))}
              </div>
            </CardReorderContext>
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
        // Scene-less character (created without a scene): the editor is locked
        // and THIS is the page's one live control. It shows exactly where to
        // save the scene (the subfolder seeded at creation) and links it — the
        // page unlocks the moment the primary lands.
        <div className="space-y-3 rounded-lg border border-dashed p-4 py-6 text-sm text-muted-foreground">
          <p>
            No Daz scene yet. Save your scene (.duf) from Daz Studio into this character&apos;s
            scenes folder, then link it here — or drop the file anywhere on this panel:
          </p>
          <DirPathChip
            dir={displayPath(
              `${charFolder}/${cleanSub(defaultSubdir)}/${PRIMARY_SCENE_SUBFOLDER}`,
            )}
            roots={[displayPath(charFolder), displayPath(location.libraryFolder)]}
          />
          <div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={busy}
              onClick={() => void onPick()}
            >
              <Link2 /> {busy ? 'Linking…' : 'Link Daz scene'}
            </Button>
          </div>
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
              placeholder={`e.g. ${defaultSubdir}/${PRIMARY_SCENE_SUBFOLDER}`}
              onChange={(e) => setSubfolder(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void applyLink(pending, false)}>
              Link in place
            </Button>
            <Button
              disabled={busy || subfolder.trim() === ''}
              title={
                subfolder.trim() === ''
                  ? 'Enter a subfolder — every scene lives in its own subfolder now'
                  : undefined
              }
              onClick={() => void applyLink(pending, true)}
            >
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
            title={
              replaceMode ? 'Replace the primary Daz scene?' : 'Add Daz scene to the character?'
            }
            dismissible={!busy}
            className="max-w-3xl"
          >
            <div>
              <Label className="mb-1 block">Selected file</Label>
              <PathCode path={displayPath(pendingAdd)} className={tallPathChipClass} />
            </div>
            {addValidation}
            {replaceOldBlock}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => setPendingAdd('')}>
                Cancel
              </Button>
              <Button
                disabled={busy || addBlocked}
                title={addBlocked ? addBlockedTitle : undefined}
                onClick={() =>
                  void (replaceMode ? applyReplace : applyAdd)(pendingAdd, false)
                }
              >
                {busy
                  ? replaceMode
                    ? 'Replacing…'
                    : 'Adding…'
                  : replaceMode
                    ? 'Replace scene'
                    : 'Add scene'}
              </Button>
            </div>
          </Modal>
        ) : (
          <SceneCopyDialog
            title={
              replaceMode ? 'Replace the primary Daz scene?' : 'Add Daz scene to the character?'
            }
            description="The selected scene lives outside the character folder. Copy it into the character folder?"
            className="max-w-3xl"
            filePath={pendingAdd}
            prefix={displayPath(`${baseDazRel}/`)}
            subfolder={addSubfolder}
            onSubfolderChange={setAddSubfolder}
            deleteOriginal={deleteOriginal}
            onDeleteOriginalChange={setDeleteOriginal}
            busy={busy}
            error={error}
            copyLabel={replaceMode ? 'Copy & replace' : 'Copy & add'}
            validation={addValidation}
            extra={replaceOldBlock}
            confirmDisabled={addBlocked}
            confirmDisabledTitle={addBlockedTitle}
            requireSubfolder
            onCopy={() => void (replaceMode ? applyReplace : applyAdd)(pendingAdd, true)}
            onLink={() => void (replaceMode ? applyReplace : applyAdd)(pendingAdd, false)}
            onClose={() => setPendingAdd('')}
          />
        ))}

      {pendingRemove && (
        <RemoveAssetDialog
          title="Remove Daz scene?"
          // For a linked-in-place scene the delete toggle is locked off, so the
          // base sentence is the whole story; otherwise the copy names what a
          // delete takes with it (see removeDeleteExplainer).
          description={
            !insideCharFolder(pendingRemove)
              ? 'Unlink this Daz scene from the character.'
              : `Unlink this Daz scene from the character.${removeDeleteExplainer}`
          }
          deleteFile={removeDeleteFile}
          onDeleteFileChange={setRemoveDeleteFile}
          // A scene linked in place (outside the character folder) is the user's
          // original — disable delete so it can only be unlinked, never removed.
          deleteFileDisabled={!insideCharFolder(pendingRemove)}
          // The dialog's default "Delete" — with the toggle no longer pre-ticked,
          // the confirm must read as deletion exactly when the toggle says so
          // ("Remove" was ambiguous about the file).
          deleteLabel="Delete"
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
      <MultipleDazModal open={multiDaz} onClose={() => setMultiDaz(false)} />

      {/* Mounted only while open, like the Houdini Utils drawer — the drawer
          probes the Runner and the scan plan on mount. Guarded against the
          scene unlinking underneath it (the drawer's scope would be gone). */}
      {utilsFor && [character.scenePath, ...character.extraScenes].includes(utilsFor) && (
        <DazSceneUtilsPanel
          open
          character={character}
          // The drawer acts on THIS scene alone — `utilsFor` is the card whose
          // Utils button was pressed, and it is the drawer's entire scope.
          targetScene={utilsFor}
          projectId={projectId}
          persistPatch={persistPatch}
          dazProductsEnabled={dazProductsEnabled}
          onClose={() => setUtilsFor('')}
        />
      )}
    </FileDropZone>
  )
}
