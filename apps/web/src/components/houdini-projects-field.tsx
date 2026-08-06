import { useEffect, useState } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { DirPathChip, displayDirOf } from '#/components/dir-path-chip.tsx'
import { HoudiniUtilsPanel } from '#/components/character/houdini-utils-panel.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import {
  Button,
  Input,
  InfoPopup,
  Label,
  LinkedAssetCard,
  Modal,
  RemoveAssetDialog,
  useModifierHeld,
  useRefetchOnFocus,
} from '@dth/ui'
import houdiniLogo from '#/assets/houdini-logo.svg'
import {
  fileExists,
  generatedHoudiniScenePath,
  generateHoudiniProject,
  openScene,
  removeGeneratedHoudiniProject,
  revealPath,
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
  onOpen,
  onRemove,
  onUtils,
}: {
  hipPath: string
  /** Gender-based placeholder avatar (a Houdini project has no thumbnail). */
  avatarSrc: string
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
 * scenes). Houdini projects are linked in place and never copied: a Houdini DTH
 * project stores absolute import paths for its referenced files, so relocating it
 * would break those references. "Add project" picks a `.hip` and links it as-is.
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
  // Remove dialog: "Keep houdini files" ON (the safe default) = unlink only;
  // OFF = also delete the scene file + the Houdini project folder from disk.
  // Only offered for GENERATED projects (living directly in the export dir) —
  // hand-linked ones stay unlink-only like before.
  const [keepFiles, setKeepFiles] = useState(true)

  // The Houdini project whose Utils drawer is open ('' = closed). The path also
  // seeds the drawer's target preselection.
  const [utilsFor, setUtilsFor] = useState('')

  // A project pending the unlink confirm. Houdini projects are only ever linked
  // in place (absolute import paths forbid copying), so removing is unlink-only —
  // never a file delete, which would hit the user's real .hip.
  const [pendingRemove, setPendingRemove] = useState('')

  const projects = character.houdiniProjects
  const hasProjects = projects.length > 0
  // Only the export root is needed now — the project folder is a fixed name the
  // generate creates (or reuses) by itself.
  const canGenerate = character.exportPath.trim() !== ''

  // A linked `.hip` deleted/moved on disk must not keep masquerading as a
  // healthy card — probe each link and re-probe on window focus (tabbing back
  // from Explorer/Houdini is exactly when files change).
  const [missingSet, setMissingSet] = useState<ReadonlySet<string>>(new Set())
  const projectsKey = projects.join('|')
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
  async function addProjects(paths: Array<string>, toastTitle?: string) {
    // De-dupe case-insensitively on the normalised path (Windows): dropping
    // `d:/x.hip` after `D:\x.hip` was picked must not link the same project twice.
    const linked = new Set(character.houdiniProjects.map((p) => normalizePath(p).toLowerCase()))
    const fresh = paths.filter((p) => !linked.has(normalizePath(p).toLowerCase()))
    if (fresh.length === 0) return
    setBusy(true)
    setError('')
    await persistPatch(
      { houdiniProjects: [...character.houdiniProjects, ...fresh] },
      {
        toast:
          toastTitle ??
          (fresh.length === 1 ? 'Linked Houdini project' : `Linked ${fresh.length} Houdini projects`),
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
    if (picked) await addProjects([picked])
  }

  // A GENERATED project lives directly in the character's HOUDINI folder —
  // those are studio-managed like a copied Daz scene, so the remove dialog may
  // also delete their scene file.
  const houdiniDir = characterHoudiniDir(location?.folderAbs ?? '', houdiniSubdir)
  const managedProject = (hip: string) => {
    const dir = normalizePath(houdiniDir).toLowerCase()
    if (!dir) return false
    return normalizePath(parentDir(hip)).toLowerCase() === dir
  }

  function askRemove(hip: string) {
    setError('')
    setKeepFiles(true) // keep is the safe default on every open
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
      onDrop={(paths) => void addProjects(paths)}
      label="Drop Houdini project(s) to link"
      className="rounded-lg"
    >
      {/* Same title treatment as the "Daz scenes" section — the two section
          headers sit stacked in the scenes tab and must read as peers. */}
      <Label className={`${hasProjects ? 'mb-1' : 'mb-2'} flex w-fit items-center gap-1 text-xl font-semibold`}>
        Houdini projects
        <InfoPopup label="Houdini projects — more information">
          Linked in place (not copied) — a Houdini project keeps absolute import paths that a
          copy would break. Drag <code>.hip</code> files here or use the button.
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
          <Plus /> {busy ? 'Linking…' : 'Add project'}
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

      {generateOpen && (
        <GenerateProjectDialog
          projectId={projectId}
          character={character}
          projectName={projectName}
          houdiniDir={houdiniDir}
          onClose={() => setGenerateOpen(false)}
          onGenerated={async (scenePath, networkAdded, visibleTypes) => {
            await addProjects(
              [scenePath],
              networkAdded
                ? 'Houdini project generated — DazToHue network and Set Project are baked in'
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
          onClose={() => setUtilsFor('')}
        />
      )}

      {pendingRemove && (
        <RemoveAssetDialog
          title="Remove Houdini project?"
          description={
            managedProject(pendingRemove)
              ? 'This project was generated by the studio. With "Keep houdini files" on it is only unlinked; turned off, the scene file is deleted from disk (the shared houdini-project folder stays — other projects use it).'
              : 'Unlink this Houdini project from the character.'
          }
          // Generated projects are studio-managed (like a copied Daz scene):
          // the keep-toggle decides between unlink-only and a real delete.
          // Hand-linked projects stay unlink-only — never delete the user's
          // original file.
          showDeleteFile={managedProject(pendingRemove)}
          deleteFile={!keepFiles}
          onDeleteFileChange={(value) => setKeepFiles(!value)}
          toggleLabel="Keep houdini files"
          invertToggle
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
 * `$JOB` baked to the character's `<export dir>/<Houdini project folder>`
 * (the programmatic File → Set Project), saved as `<name>.hiplc` at that
 * folder's root — and the new scene is linked as a Houdini project card.
 * Needs the Houdini installation folder in Settings (api/houdini.ts reports
 * every gap as a precise error).
 */
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
  ) => Promise<void>
}) {
  const [name, setName] = useState(defaultProjectName(projectName, character.name))
  const [busy, setBusy] = useState(false)
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
        data: { projectId, id: character.id, sceneName: name },
      })
      await onGenerated(result.scenePath, result.networkAdded, result.visibleTypes)
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
            and <em>Set Project</em> baked to the character&apos;s Houdini project folder:
            every import resolves relative to the scene file (<code>$HIP/../…</code>), so the
            project stays moveable. Runs Houdini&apos;s <code>hython</code>; the first start
            can take a moment.
          </InfoPopup>
        </span>
      }
      dismissible={!busy}
    >
      <p className="text-xs text-muted-foreground">
        Creates <code>{(name.trim() || '<name>') + '.hiplc'}</code> into{' '}
        <code>{`.\\${houdiniDirName}`}</code>, next to the shared{' '}
        <code>houdini-project</code> folder it opens with.
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
