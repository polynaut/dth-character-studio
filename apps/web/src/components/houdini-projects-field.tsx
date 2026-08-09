import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { DirPathChip, displayDirOf } from '#/components/dir-path-chip.tsx'
import { HoudiniUtilsPanel } from '#/components/character/houdini-utils-panel.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { SceneCopyDialog } from '#/components/scene-copy-dialog.tsx'
import {
  Button,
  Input,
  InfoPopup,
  Label,
  LinkedAssetCard,
  Modal,
  RemoveAssetDialog,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useModifierHeld,
  useRefetchOnFocus,
} from '@dth/ui'
import houdiniLogo from '#/assets/houdini-logo.svg'
import {
  copyHoudiniProject,
  fetchHoudiniProjectStatus,
  fileExists,
  generatedHoudiniScenePath,
  generateHoudiniProject,
  openScene,
  removeGeneratedHoudiniProject,
  revealPath,
  scanCharacterHoudiniProjects,
} from '#/lib/rom/api.ts'
import { pickHipPath } from '#/lib/desktop.ts'
import { browseStart, displayPath, normalizePath, parentDir } from '#/lib/path.ts'
import { characterHoudiniDir } from '#/lib/scene-subfolder.ts'

/** Folder/file-name-safe `<Project>_<Character>` — the Generate dialog's
 *  prefilled scene name (Windows-illegal characters collapse to one space,
 *  the same rule the api layer's cleanFileName applies to what's typed). */
function defaultProjectName(projectName: string, characterName: string): string {
  const clean = (s: string) =>
    s
      .trim()
      .replace(/[\r\n<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  return [clean(projectName), clean(characterName)].filter(Boolean).join('_')
}

import type { CharacterLocation } from '#/lib/rom/api.ts'
import type { PersistCharacterPatch } from '#/lib/use-character-draft.ts'
import type { Character } from '@dth/rom'

/** A linked Houdini project: the Houdini logo (no preview image), the filename,
 *  and its folder — the corner icon opens it in Houdini. A Houdini project has no
 *  per-card state to select (unlike a Daz scene), so the rest of the card is
 *  inert (`openIconOnly`). Houdini projects are linked in place (never copied),
 *  so the folder is shown in full. */
function HoudiniCard({
  hipPath,
  avatarSrc,
  warning,
  onOpen,
  onRemove,
  onUtils,
}: {
  hipPath: string
  /** Gender-based placeholder avatar (a Houdini project has no thumbnail). */
  avatarSrc: string
  /** What the last background scan found wrong with this project; '' = healthy,
   *  or not scanned yet. Everything it can report has a repair in the Utils
   *  drawer, which is what the badge points at. */
  warning?: string
  onOpen: (e: React.MouseEvent) => void
  /** When set, a hover ✕ unlinks the project from the character. */
  onRemove?: () => void
  /** Opens the Utils drawer with this project's nodes preselected. */
  onUtils?: () => void
}) {
  const fileName = hipPath.split(/[\\/]/).pop() ?? hipPath
  // The heading shows the project name without its extension (e.g. ".hiplc").
  const displayName = fileName.replace(/\.[^./\\]+$/, '')
  // Alt held → the open icon previews the alternate action (show in Explorer).
  const altHeld = useModifierHeld('Alt')
  return (
    <LinkedAssetCard
      title={displayName}
      media={
        <Portrait
          src={avatarSrc}
          name={displayName}
          className="aspect-[3/4] w-14 shrink-0 rounded-md"
          fallbackClassName="text-xl"
        />
      }
      // Houdini brand mark, floating bottom-left as a badge on the avatar.
      badge={
        <img
          src={houdiniLogo}
          alt=""
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 size-6 object-contain drop-shadow-[0_4px_4px_rgba(0,0,0,0.6)]"
        />
      }
      // The scan verdict, pinned bottom-left: a project that will fail when it
      // opens should say so here, not the first time an import comes up empty
      // in Houdini. Everything it reports is repairable in the Utils drawer.
      extra={
        warning ? (
          <span
            className="flex items-center gap-1 text-xs text-amber-500"
            title={warning}
            aria-label={`Needs attention: ${warning}`}
          >
            <AlertTriangle className="size-3.5 shrink-0" />
            Needs attention
          </span>
        ) : undefined
      }
      altHeld={altHeld}
      openTitle="Open in Houdini"
      accentClass="group-hover:text-houdini-orange"
      cardClass="houdini-card"
      barClass="bg-houdini-orange"
      openIconOnly
      onOpen={onOpen}
      onRemove={onRemove}
      removeTitle="Unlink from character"
      onUtils={onUtils}
      utilsTitle="Utils — copy material setups between projects"
    />
  )
}

/**
 * The character's Houdini projects — a flat list (no primary / avatar, unlike Daz
 * scenes). Houdini projects are linked in place and never copied.
 *
 * NOT because a `.hip` must hold absolute paths — it needn't, and the studio's
 * own Generate project deliberately authors relative ones (`$JOB/…`). It is
 * because moving a project is only safe when BOTH hold: every reference is
 * relative, AND its `$JOB` project folder travels with it. The studio can
 * guarantee neither for a `.hip` the user authored elsewhere, and a copy that
 * silently breaks half a project's references is worse than not copying.
 *
 * "Add project" picks a `.hip` and links it as-is.
 */
export function HoudiniProjectsField({
  character,
  location,
  persistPatch,
  houdiniSubdir = '',
  projectId,
  projectName,
}: {
  character: Character
  location: CharacterLocation
  /** The draft hook's immediate-persist primitive — link/unlink go through it
   *  so validation, single-flight and regeneration are never skipped. */
  persistPatch: PersistCharacterPatch
  /** The project's Houdini subfolder (seeded at creation) — shown as the
   *  folder chip while no project is linked yet. */
  houdiniSubdir?: string
  projectId: string
  /** The studio project's name — seeds the Generate dialog's project name. */
  projectName: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [generateOpen, setGenerateOpen] = useState(false)
  /** Picked/dropped `.hip`s that live OUTSIDE the character folder, waiting on
   *  the copy-vs-link dialog. */
  const [pendingAdd, setPendingAdd] = useState<Array<string>>([])
  const [addDeleteOriginal, setAddDeleteOriginal] = useState(false)
  // Remove dialog: "Keep houdini files" ON (the safe default) = unlink only;
  // OFF = also delete the scene file + the Houdini project folder from disk.
  // Only offered for GENERATED projects (living directly in the export dir) —
  // hand-linked ones stay unlink-only like before.
  const [keepFiles, setKeepFiles] = useState(true)

  // The Houdini project whose Utils drawer is open ('' = closed). The path also
  // seeds the drawer's target preselection.
  const [utilsFor, setUtilsFor] = useState('')

  // A project pending the unlink confirm. Houdini projects are only ever linked
  // in place (moving one safely needs relative refs AND its $JOB folder — see
  // the component doc), so removing is unlink-only —
  // never a file delete, which would hit the user's real .hip.
  const [pendingRemove, setPendingRemove] = useState('')

  const projects = character.houdiniProjects
  const hasProjects = projects.length > 0
  // Only the export root is needed now — the project folder is a fixed name the
  // generate creates (or reuses) by itself.
  const canGenerate = character.exportPath.trim() !== ''

  const projectsKey = projects.join('|')
  // What the last background scan found wrong with each project, by normalized
  // path. Two things happen on every mount and whenever the linked set changes:
  // a background sweep is kicked off (cheap once the cache is warm — an unchanged
  // `.hip` never starts a process), and the STORED verdicts are read back. The
  // read is instant and needs no Houdini; the sweep fills the store for next
  // time, which is why a first-ever open shows no badges and a later one does.
  const [warnings, setWarnings] = useState<ReadonlyMap<string, string>>(new Map())
  /** Read the STORED verdicts. Instant and needs no Houdini — the sweep is what
   *  fills the store. */
  const readWarnings = useCallback(async () => {
    const status = await fetchHoudiniProjectStatus({ data: { projectId, id: character.id } })
    setWarnings(
      new Map(
        status.filter((s) => !s.ok).map((s) => [normalizePath(s.hipPath).toLowerCase(), s.summary]),
      ),
    )
  }, [projectId, character.id])

  useRefetchOnFocus(
    () => {
      void (async () => {
        // Paint from the store first: it is instant, and a warm cache is right.
        await readWarnings().catch(() => {})
        // Then AGAIN once the sweep has landed. Without this second read the
        // badge keeps whatever the store held BEFORE the scan — which is how a
        // project could show "Needs attention" while the drawer, which scans
        // live, reported every check passing. The sweep coalesces per character,
        // and an unchanged `.hip` never starts a process, so this is cheap.
        await scanCharacterHoudiniProjects({ data: { projectId, id: character.id } }).catch(
          () => {},
        )
        await readWarnings().catch(() => {})
      })()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectsKey, projectId, character.id],
    { immediate: true },
  )

  // A linked `.hip` deleted/moved on disk must not keep masquerading as a
  // healthy card — probe each link and re-probe on window focus (tabbing back
  // from Explorer/Houdini is exactly when files change).
  const [missingSet, setMissingSet] = useState<ReadonlySet<string>>(new Set())
  useRefetchOnFocus(
    () => {
      void (async () => {
        const checks = await Promise.all(
          projects.map(async (p) => [p, await fileExists({ data: { path: p } })] as const),
        )
        setMissingSet(new Set(checks.filter(([, ok]) => !ok).map(([p]) => p)))
      })()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectsKey],
    { immediate: true },
  )
  // The character's own folder — projects linked inside it show a "%CHAR%" prefix.
  const charFolder = parentDir(location.definitionAbs)
  // A Houdini project has no thumbnail — use a gender-based placeholder avatar.
  const placeholderSrc =
    character.gender === 'male' ? '/charPlaceholderMale.png' : '/charPlaceholderFemale.png'

  // Folder chip for the linked projects (the first project's directory):
  // everything through the CHARACTER folder is dimmed — only the actual
  // subfolder ("\houdini") reads bright, matching the Daz scenes chip. A
  // project outside the character folder falls back to the project root.
  // With NO project linked yet, the chip shows the character's seeded Houdini
  // folder instead — the place a new project belongs.
  const emptyStateDir = houdiniSubdir ? displayPath(`${charFolder}/${houdiniSubdir}`) : ''
  const chipDir = hasProjects ? displayDirOf(projects[0] ?? '') : emptyStateDir
  const projectDirChip = chipDir ? (
    <DirPathChip
      dir={chipDir}
      roots={[displayPath(charFolder), displayPath(location.libraryFolder)]}
    />
  ) : null

  // Alt+click = the app-wide "show in Explorer" hotkey (same as path chips
  // and the Unreal cards); plain click opens the project in Houdini.
  async function onOpen(hipPath: string, e?: React.MouseEvent) {
    setError('')
    try {
      if (e?.altKey) await revealPath({ data: { path: hipPath } })
      else await openScene({ data: { scenePath: hipPath } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(e?.altKey ? msg : `Couldn't open in Houdini: ${msg}`)
    }
  }

  // Houdini projects are linked in place — store each `.hip` path as-is, skipping
  // any already linked. Shared by the Browse button, OS drag-and-drop and the
  // Generate dialog (which passes its own success toast).
  /**
   * Link the paths that are already inside the character folder, and hold the
   * rest for the copy-vs-link dialog.
   *
   * Same shape as the Daz-scene flow: the decision belongs AFTER the pick, on a
   * file the studio can see the location of — a toggle asked up front had to be
   * answered before knowing whether the file was even external, and for a `.hip`
   * that already lives in the character's houdini folder there is nothing to
   * decide.
   */
  function beginAdd(paths: Array<string>) {
    const inside = paths.filter((p) => insideCharFolder(p))
    const outside = paths.filter((p) => !insideCharFolder(p))
    if (inside.length > 0) void addProjects(inside, { copy: false })
    if (outside.length > 0) setPendingAdd(outside)
  }

  /** A picked `.hip` already under the character's own folder — copying it
   *  would duplicate a file that is already where it belongs. */
  function insideCharFolder(p: string): boolean {
    const root = normalizePath(charFolder).toLowerCase()
    return normalizePath(p).toLowerCase().startsWith(`${root}/`)
  }

  async function addProjects(
    paths: Array<string>,
    { copy, deleteOriginal = false }: { copy: boolean; deleteOriginal?: boolean },
    toastTitle?: string,
  ) {
    // De-dupe case-insensitively on the normalised path (Windows): dropping
    // `d:/x.hip` after `D:\x.hip` was picked must not link the same project twice.
    const linked = new Set(character.houdiniProjects.map((p) => normalizePath(p).toLowerCase()))
    let fresh = paths.filter((p) => !linked.has(normalizePath(p).toLowerCase()))
    if (fresh.length === 0) return
    setBusy(true)
    setError('')
    // COPY (or move) the file in first, when asked — what the character links is
    // then the copy. A copied `.hip` arrives carrying the source's `$JOB` and
    // absolute references, so the toast points at the Utils drawer; the card's
    // checks will be flagging it as soon as the background sweep has run.
    let copied = 0
    if (copy && projectId) {
      // Sequential on purpose, not for politeness: the copy refuses a name
      // already in the folder, and two dropped files sharing a basename would
      // both pass that check at once if they ran together. A failure stops the
      // batch but keeps what already came in — with Move on, those originals
      // are gone, so a copy that made it MUST get its card or the user loses
      // track of their own file.
      const bringIn = async (
        rest: Array<string>,
        done: Array<string>,
      ): Promise<{ done: Array<string>; failed: string }> => {
        const [head, ...tail] = rest
        if (head === undefined) return { done, failed: '' }
        try {
          const dest = await copyHoudiniProject({
            data: { projectId, id: character.id, hipPath: head, deleteOriginal },
          })
          return bringIn(tail, [...done, dest])
        } catch (e) {
          return { done, failed: e instanceof Error ? e.message : String(e) }
        }
      }
      const brought = await bringIn(fresh, [])
      if (brought.failed) setError(brought.failed)
      copied = brought.done.length
      fresh = brought.done
      if (fresh.length === 0) {
        setBusy(false)
        return
      }
    }
    await persistPatch(
      { houdiniProjects: [...character.houdiniProjects, ...fresh] },
      {
        toast:
          toastTitle ??
          (copied > 0
            ? `${deleteOriginal ? 'Moved' : 'Copied'} ${copied} Houdini project${
                copied === 1 ? '' : 's'
              } in — open Utils to repoint anything the copy left behind`
            : fresh.length === 1
              ? 'Linked Houdini project'
              : `Linked ${fresh.length} Houdini projects`),
      },
    )
    setBusy(false)
  }

  async function onAddPick() {
    // Start beside the projects already linked (a second `.hiplc` for the same
    // character is nearly always a sibling), else the character's own Houdini
    // folder — where Generate project puts them.
    const picked = await pickHipPath(
      'Select a Houdini project (.hip)',
      browseStart(parentDir(character.houdiniProjects[0] ?? ''), houdiniDir),
    )
    if (picked) beginAdd([picked])
  }

  const houdiniDir = characterHoudiniDir(location?.folderAbs ?? '', houdiniSubdir)
  /**
   * The project sits directly in the character's HOUDINI folder — generated
   * there, or copied in (v0.68). Either way it is the studio's copy, so
   * removing the card may remove the file; a project linked from the user's own
   * tree is their original and is only ever unlinked.
   *
   * Same QUESTION the Daz-scene field asks of a scene ("is this our copy or
   * their file?"), and the two dialogs now answer it identically. The test
   * differs only in where each asset type's copies live — and this one must
   * stay exactly the houdini folder, because `removeGeneratedHoudiniProject`
   * refuses anything else outright.
   */
  const managedProject = (hip: string) => {
    const dir = normalizePath(houdiniDir).toLowerCase()
    if (!dir) return false
    return normalizePath(parentDir(hip)).toLowerCase() === dir
  }

  function askRemove(hip: string) {
    setError('')
    // Default follows WHERE the file is: the studio's own copy goes with the
    // card (the button reads "Remove"), the user's original never does
    // ("Unlink"). The toggle overrides either way.
    setKeepFiles(!managedProject(hip))
    setPendingRemove(hip)
  }

  async function confirmRemove() {
    const hip = pendingRemove
    setBusy(true)
    setError('')
    if (!keepFiles && managedProject(hip)) {
      try {
        await removeGeneratedHoudiniProject({
          data: { projectId, id: character.id, hipPath: hip },
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setBusy(false)
        return
      }
    }
    const saved = await persistPatch(
      { houdiniProjects: character.houdiniProjects.filter((p) => p !== hip) },
      {
        toast:
          !keepFiles && managedProject(hip)
            ? 'Removed Houdini project — the scene file and project folder were deleted'
            : 'Unlinked Houdini project',
      },
    )
    if (saved) setPendingRemove('')
    setBusy(false)
  }

  return (
    <FileDropZone
      accept={['hip', 'hipnc', 'hiplc']}
      onDrop={(paths) => beginAdd(paths)}
      label="Drop Houdini project(s) to link"
      className="rounded-lg"
    >
      {/* Same title treatment as the "Daz scenes" section — the two section
          headers sit stacked in the scenes tab and must read as peers. */}
      <Label className={`${hasProjects ? 'mb-1' : 'mb-2'} flex w-fit items-center gap-1 text-xl font-semibold`}>
        Houdini projects
        <InfoPopup label="Houdini projects — more information">
          Linked in place, never copied — moving a Houdini project safely needs every reference
          to be relative <em>and</em> its <code>$JOB</code> project folder to travel with it, and
          the studio can&apos;t guarantee that for a project you authored elsewhere. Drag{' '}
          <code>.hip</code> files here or use the button.
        </InfoPopup>
      </Label>
      {projectDirChip && <p className="mb-3 text-xs">{projectDirChip}</p>}

      {hasProjects && (
        <div className="flex flex-wrap items-start gap-3">
          {projects.map((hip) =>
            missingSet.has(hip) ? (
              // The file is gone on disk (deleted/moved outside the studio) —
              // same dashed-destructive treatment as a missing Daz scene.
              <div
                key={hip}
                className="flex items-center gap-3 rounded-lg border border-dashed border-destructive/50 p-3 text-sm text-muted-foreground"
              >
                <span>
                  <code>{hip.split(/[\\/]/).pop()}</code> is missing on disk — deleted or moved
                  outside the studio?
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => askRemove(hip)}
                >
                  Unlink
                </Button>
              </div>
            ) : (
              <HoudiniCard
                key={hip}
                hipPath={hip}
                avatarSrc={placeholderSrc}
                warning={warnings.get(normalizePath(hip).toLowerCase()) ?? ''}
                onOpen={(e) => void onOpen(hip, e)}
                onRemove={() => askRemove(hip)}
                onUtils={() => setUtilsFor(hip)}
              />
            ),
          )}
        </div>
      )}
      <div className={`flex flex-wrap gap-2 ${hasProjects ? 'mt-3' : ''}`}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void onAddPick()}>
          <Plus /> {busy ? 'Working…' : 'Add project'}
        </Button>
        {/* Generate: hython creates a ready-made DazToHue project from the
            user's template, with $JOB baked to <exportDir>/<projectFolder> —
            possible only once that layout exists. */}
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !canGenerate}
          title={
            canGenerate
              ? undefined
              : 'Set an export directory and a Houdini project folder first (Export directory panel)'
          }
          onClick={() => setGenerateOpen(true)}
        >
          <Sparkles /> Generate project
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {pendingAdd.length > 0 && (
        <SceneCopyDialog
          title={
            pendingAdd.length === 1
              ? 'Copy this Houdini project in, or link it?'
              : `Copy these ${pendingAdd.length} Houdini projects in, or link them?`
          }
          description={
            <>
              A copied project lands in this character&apos;s Houdini folder (
              <code>{houdiniSubdir || 'houdini'}</code>) — there is no subfolder to
              choose. Linking leaves the file exactly where it is and records a path
              to it.
            </>
          }
          filePath={pendingAdd.length === 1 ? pendingAdd[0] : undefined}
          deleteOriginal={addDeleteOriginal}
          onDeleteOriginalChange={setAddDeleteOriginal}
          busy={busy}
          error={error || undefined}
          copyLabel={pendingAdd.length === 1 ? 'Copy in' : 'Copy them in'}
          onCopy={() => {
            const paths = pendingAdd
            setPendingAdd([])
            void addProjects(paths, { copy: true, deleteOriginal: addDeleteOriginal })
          }}
          onLink={() => {
            const paths = pendingAdd
            setPendingAdd([])
            void addProjects(paths, { copy: false })
          }}
          onClose={() => {
            setPendingAdd([])
            setAddDeleteOriginal(false)
          }}
        />
      )}

      {generateOpen && (
        <GenerateProjectDialog
          projectId={projectId}
          character={character}
          projectName={projectName}
          houdiniDir={houdiniDir}
          onClose={() => setGenerateOpen(false)}
          onGenerated={async (scenePath, networkAdded, visibleTypes, prefilled) => {
            await addProjects(
              [scenePath],
              { copy: false },
              networkAdded
                ? prefilled.length > 0
                  ? 'Houdini project generated — DazToHue network, Set Project and the import/export paths are baked in'
                  : 'Houdini project generated — DazToHue network and Set Project are baked in'
                : 'Houdini project generated (Set Project baked in) — add the DazToHue network from the shelf',
            )
            if (!networkAdded) {
              // Diagnosis for the missing network: no types at all = the otls
              // never loaded in hython; types visible = the DazToHue shelf
              // tool itself couldn't run headless (or wasn't found) — nothing
              // synthetic is built in its place, the scene stays empty.
              toast.info(
                visibleTypes.length === 0
                  ? 'hython saw no DazToHue node types — the DazToHue otls did not load (check the Houdini documents folder in Settings).'
                  : 'The DazToHue shelf tool could not run in hython — open the generated project and click the DazToHue shelf tool once.',
              )
            }
          }}
        />
      )}

      {/* Mounted only while open: the drawer scans the linked projects with
          hython on mount, which must never happen just because the tab rendered. */}
      {utilsFor && (
        <HoudiniUtilsPanel
          open
          character={character}
          initialHipPath={utilsFor}
          projectId={projectId}
          // The General tab checks each project's `$JOB`, which should be the
          // CHARACTER folder (v0.64).
          charFolder={charFolder}
          onClose={() => {
            setUtilsFor('')
            // The drawer scans live and writes what it found to the same store,
            // so its answer is fresher than the badge's — pick it up on close
            // rather than leaving the card contradicting the tab the user was
            // just reading.
            void readWarnings().catch(() => {})
          }}
        />
      )}

      {pendingRemove && (
        <RemoveAssetDialog
          title="Remove Houdini project?"
          description="Unlink this Houdini project from the character."
          deleteFile={!keepFiles}
          onDeleteFileChange={(value) => setKeepFiles(!value)}
          // A project linked in place (outside the character folder) is the
          // user's original — the toggle is shown but locked off, so "you
          // cannot delete this" is visible rather than silently absent.
          deleteFileDisabled={!managedProject(pendingRemove)}
          deleteLabel="Remove"
          busy={busy}
          error={error}
          onConfirm={() => void confirmRemove()}
          onClose={() => setPendingRemove('')}
        />
      )}
    </FileDropZone>
  )
}

/**
 * "Generate project": one required name input (prefilled
 * `<Project>_<Character>`), then hython creates the ready-made DazToHue
 * project — a fresh scene with the DazToHue network instantiated from the
 * INSTALLED HDA (no template file to rot across Houdini/DazToHue versions),
 * `$JOB` baked to the CHARACTER folder (the programmatic File → Set Project —
 * it holds both the houdini scenes and the Daz-side exports, so a picked export
 * collapses to `$JOB/…`), saved as `<name>.hiplc` in the character's houdini
 * folder — and the new scene is linked as a Houdini project card.
 * Needs the Houdini installation folder in Settings (api/houdini.ts reports
 * every gap as a precise error).
 */
/** A linked scene as the picker names it: its file stem, which is what the user
 *  sees on the scene cards and in Daz. */
function sceneLabel(scenePath: string): string {
  const base = scenePath.replace(/\\/g, '/').split('/').pop() ?? scenePath
  return base.replace(/\.[^.]+$/, '') || scenePath
}

function GenerateProjectDialog({
  projectId,
  character,
  projectName,
  houdiniDir,
  onClose,
  onGenerated,
}: {
  projectId: string
  character: Character
  projectName: string
  /** The character's Houdini folder — where the `.hiplc` lands. */
  houdiniDir: string
  onClose: () => void
  /** Links the generated `.hiplc` (the caller owns the persist + toast). */
  onGenerated: (
    scenePath: string,
    networkAdded: boolean,
    visibleTypes: Array<string>,
    prefilled: Array<string>,
  ) => Promise<void>
}) {
  const [name, setName] = useState(defaultProjectName(projectName, character.name))
  const [busy, setBusy] = useState(false)
  // Which scene's export set the new network imports. Every linked scene exports
  // into its OWN `daz-export/<subfolder>/`, so on a multi-scene character this
  // is the difference between a project wired to the outfit you meant and one
  // wired to the primary — five paths to re-pick by hand afterwards.
  const scenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  const [dazScenePath, setDazScenePath] = useState(character.scenePath)
  // The houdini folder shown relative (".\houdini") — the dialog only needs the
  // WHERE in one word.
  const houdiniDirName = houdiniDir.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? ''

  // Live name-collision check: the api layer hard-refuses an existing target
  // (generatedHoudiniScenePath is the SAME computation), but the dialog should
  // say so upfront instead of letting Generate run into the error. Linked
  // projects answer synchronously; the disk probe debounces behind typing.
  const target = generatedHoudiniScenePath(houdiniDir, name)
  const linkedTaken =
    target !== '' &&
    character.houdiniProjects.some((p) => normalizePath(p).toLowerCase() === target.toLowerCase())
  const [diskTaken, setDiskTaken] = useState(false)
  useEffect(() => {
    setDiskTaken(false)
    if (target === '' || linkedTaken) return
    let active = true
    const timer = setTimeout(() => {
      void fileExists({ data: { path: target } }).then((exists) => {
        if (active) setDiskTaken(exists)
      })
    }, 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [target, linkedTaken])
  const taken = linkedTaken || diskTaken

  async function onGenerate() {
    setBusy(true)
    try {
      // Re-probe at click time (the debounced check may not have landed, or
      // the file appeared meanwhile): a name collision always renders as FORM
      // VALIDATION under the input — never as an error toast. Every other
      // failure (missing hython, no docs folder, …) stays a toast.
      if (linkedTaken || (target !== '' && (await fileExists({ data: { path: target } })))) {
        setDiskTaken(true)
        return
      }
      const result = await generateHoudiniProject({
        data: { projectId, id: character.id, sceneName: name, dazScenePath },
      })
      await onGenerated(result.scenePath, result.networkAdded, result.visibleTypes, result.prefilled)
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-1.5">
          Generate Houdini project
          <InfoPopup label="Generate Houdini project — more information">
            Creates a new Houdini scene with the DazToHue network — built by running your
            installed DazToHue <em>shelf tool</em>, so it always matches the current plugin —
            and <em>Set Project</em> baked to the character folder, which holds both the
            scene and the exports: every import resolves relative to that project folder
            (<code>$JOB/…</code>), so the project stays moveable. Runs Houdini&apos;s <code>hython</code>; the first start
            can take a moment.
          </InfoPopup>
        </span>
      }
      dismissible={!busy}
    >
      <p className="text-xs text-muted-foreground">
        Creates <code>{(name.trim() || '<name>') + '.hiplc'}</code> into{' '}
        <code>{`.\\${houdiniDirName}`}</code>, beside the character&apos;s other Houdini scenes.
      </p>
      <div>
        <Label htmlFor="generate-houdini-name" className="mb-1">
          Project name
        </Label>
        <Input
          id="generate-houdini-name"
          className="w-full"
          value={name}
          disabled={busy}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() !== '' && !busy && !taken) void onGenerate()
          }}
        />
        {taken && (
          <p className="mt-1 text-xs text-destructive">
            A project with this name already exists — choose another name, or remove the
            existing project first.
          </p>
        )}
      </div>
      {/* Only worth asking when there IS a choice: one scene has exactly one
          export set, and a picker with a single option is a question with one
          answer. */}
      {scenes.length > 1 && (
        <div>
          <Label htmlFor="generate-houdini-scene" className="mb-1">
            Daz scene to import
          </Label>
          <Select value={dazScenePath} onValueChange={setDazScenePath} disabled={busy}>
            <SelectTrigger id="generate-houdini-scene" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scenes.map((scene) => (
                <SelectItem key={scene} value={scene}>
                  {sceneLabel(scene)}
                  {scene === character.scenePath ? ' (primary)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            The network&apos;s import paths are filled from this scene&apos;s export folder.
            Generate one project per scene to cover them all.
          </p>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy || name.trim() === '' || taken}
          title={
            taken
              ? 'A project with this name already exists'
              : name.trim() === ''
                ? 'The project name cannot be empty'
                : undefined
          }
          onClick={() => void onGenerate()}
        >
          <Sparkles /> {busy ? 'Generating…' : 'Generate'}
        </Button>
      </div>
    </Modal>
  )
}
