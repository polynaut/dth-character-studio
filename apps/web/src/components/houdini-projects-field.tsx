import { useEffect, useState } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { DirPathChip, displayDirOf } from '#/components/dir-path-chip.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import {
  Button,
  Input,
  InfoPopup,
  Label,
  LinkedAssetCard,
  Modal,
  OverrideMark,
  RemoveAssetDialog,
  cn,
  overrideLabelClass,
  useModifierHeld,
  useRefetchOnFocus,
} from '@dth/ui'
import houdiniLogo from '#/assets/houdini-logo.svg'
import {
  fileExists,
  generateHoudiniProject,
  openScene,
  removeGeneratedHoudiniProject,
  revealPath,
} from '#/lib/rom/api.ts'
import { pickHipPath } from '#/lib/desktop.ts'
import { displayPath, normalizePath, parentDir } from '#/lib/path.ts'
import { defaultHoudiniProjectFolder, sceneOverrideSchema, sceneRecordEmpty } from '@dth/rom'

import type { CharacterLocation } from '#/lib/rom/api.ts'
import type { PersistCharacterPatch } from '#/lib/use-character-draft.ts'
import type { Character, SceneOverride } from '@dth/rom'

/** Folder-name-safe: the Windows-illegal characters collapse to one space
 *  (mirrors defaultHoudiniProjectFolder's cleaning in @dth/rom). */
function cleanFolderName(value: string): string {
  return value
    .trim()
    .replace(/[\r\n<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

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
}: {
  hipPath: string
  /** Gender-based placeholder avatar (a Houdini project has no thumbnail). */
  avatarSrc: string
  onOpen: (e: React.MouseEvent) => void
  /** When set, a hover ✕ unlinks the project from the character. */
  onRemove?: () => void
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
  saving,
  overrideEligible,
  sceneOverride,
  effectiveScene,
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
  saving: boolean
  /** True while an extra (non-primary) Daz scene is selected — the Houdini
   *  project folder can then be overridden per scene (useSceneSelection). */
  overrideEligible: boolean
  sceneOverride: SceneOverride | undefined
  /** The selected scene's path (keys the override record). */
  effectiveScene: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [generateOpen, setGenerateOpen] = useState(false)
  // Remove dialog: "Keep houdini files" ON (the safe default) = unlink only;
  // OFF = also delete the scene file + the Houdini project folder from disk.
  // Only offered for GENERATED projects (living directly in the export dir) —
  // hand-linked ones stay unlink-only like before.
  const [keepFiles, setKeepFiles] = useState(true)

  // The Houdini project folder under the implicit-override model: with a
  // non-primary scene selected the field edits that scene's record — a value
  // differing from the base IS the override ('' included: "this scene exports
  // flat"). Committed on blur/Enter through persistPatch (the folder only
  // takes effect at generation time). Active only WITH an export directory —
  // the folder is a layer of the export layout.
  const projectOverridden = overrideEligible && sceneOverride?.houdiniProjectFolder !== undefined
  const effectiveProject = projectOverridden
    ? (sceneOverride?.houdiniProjectFolder ?? '')
    : character.houdiniProjectFolder
  const [projectDraft, setProjectDraft] = useState(effectiveProject)
  // Resync the local text when the effective value changes under it (scene
  // selection moved, a persist settled, another window saved).
  useEffect(() => setProjectDraft(effectiveProject), [effectiveProject, effectiveScene])

  function commitProjectFolder(raw: string) {
    const value = cleanFolderName(raw)
    setProjectDraft(value)
    if (value === effectiveProject) return
    if (!overrideEligible) {
      void persistPatch(
        { houdiniProjectFolder: value },
        {
          toast: value
            ? 'Houdini project folder set — script regenerated'
            : 'Houdini project folder cleared — exports go directly into the export directory',
        },
      )
      return
    }
    const record = sceneOverride ?? sceneOverrideSchema.parse({ scenePath: effectiveScene })
    const next: SceneOverride = {
      ...record,
      houdiniProjectFolder: value === character.houdiniProjectFolder ? undefined : value,
    }
    const others = character.sceneOverrides.filter((o) => o.scenePath !== effectiveScene)
    void persistPatch(
      { sceneOverrides: sceneRecordEmpty(next) ? others : [...others, next] },
      {
        toast:
          next.houdiniProjectFolder === undefined
            ? "Scene follows the character's Houdini project folder — script regenerated"
            : value
              ? 'Scene exports into its own Houdini project folder — script regenerated'
              : 'Scene exports directly into the export directory — script regenerated',
      },
    )
  }
  // A project pending the unlink confirm. Houdini projects are only ever linked
  // in place (absolute import paths forbid copying), so removing is unlink-only —
  // never a file delete, which would hit the user's real .hip.
  const [pendingRemove, setPendingRemove] = useState('')

  const projects = character.houdiniProjects
  const hasProjects = projects.length > 0
  const canGenerate =
    character.exportPath.trim() !== '' && character.houdiniProjectFolder.trim() !== ''

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
    const picked = await pickHipPath('Select a Houdini project (.hip)')
    if (picked) await addProjects([picked])
  }

  // A GENERATED project lives directly in the character's export dir (the
  // houdini folder) — those are studio-managed like a copied Daz scene, so
  // the remove dialog may also delete their files.
  const managedProject = (hip: string) => {
    const exportDir = normalizePath(character.exportPath.trim()).toLowerCase()
    if (!exportDir) return false
    return normalizePath(parentDir(hip)).toLowerCase() === exportDir
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
      <Label className={`${hasProjects ? 'mb-1' : 'mb-2'} flex w-fit items-center gap-1`}>
        Houdini projects
        <InfoPopup label="Houdini projects — more information" className="-translate-y-px">
          Linked in place (not copied) — a Houdini project keeps absolute import paths that a
          copy would break. Drag <code>.hip</code> files here or use the button.
        </InfoPopup>
      </Label>
      {projectDirChip && <p className="mb-2 text-xs">{projectDirChip}</p>}

      {/* The Houdini project folder (schema v27): when set, everything exports
          into <folder>/dth-export/<scene subfolder>/ so a Houdini project can
          "Set Project" there and import JOB-relative. Overridable per Daz
          scene under the implicit model (like the identity dials). Active only
          with an export directory — the folder is a layer of that layout. */}
      <div className="mb-3">
        <Label
          htmlFor="houdini-project-folder"
          className={cn('mb-1', overrideLabelClass(projectOverridden, overrideEligible))}
        >
          Houdini project folder
          {overrideEligible && (
            <OverrideMark
              overridden={projectOverridden}
              onReset={() => commitProjectFolder(character.houdiniProjectFolder)}
            />
          )}
          <InfoPopup label="Houdini project folder — more information">
            When set, everything exports into{' '}
            <code>{'<folder>/dth-export/<scene subfolder>/'}</code> inside the export
            directory — use Houdini&apos;s <em>Set Project</em> on that folder and import
            JOB-relative (<code>$JOB/dth-export/…</code>), or let{' '}
            <em>Generate project</em> below build the whole project for you. Leave it empty
            to export each scene&apos;s subfolder directly into the export directory. With a
            non-primary Daz scene selected the field overrides per scene — including
            emptied, for a scene that should export flat.
          </InfoPopup>
        </Label>
        <Input
          id="houdini-project-folder"
          className={cn(
            'w-72',
            projectOverridden && 'border-daz-green',
            overrideEligible && !projectOverridden && 'text-muted-foreground',
          )}
          placeholder="No project folder — export directly"
          disabled={!character.exportPath.trim() || saving || busy}
          title={
            character.exportPath.trim()
              ? undefined
              : 'Set an export directory first (Export directory panel)'
          }
          value={projectDraft}
          onChange={(e) => setProjectDraft(e.target.value)}
          onBlur={() => commitProjectFolder(projectDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setProjectDraft(effectiveProject)
          }}
        />
        {character.exportPath.trim() !== '' && effectiveProject && (
          <p className="mt-2 text-xs text-muted-foreground">
            This scene exports into{' '}
            <code>
              {/* The gray ./<export-dir name> prefix anchors the chip: the path
                  is relative to the configured export directory. */}
              <span className="opacity-60">
                ./{character.exportPath.replace(/\\/g, '/').split('/').filter(Boolean).pop()}/
              </span>
              {effectiveProject}/dth-export/{'<scene subfolder>'}/
            </code>
            .
          </p>
        )}
      </div>

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
              // never loaded in hython; types visible but creation failed =
              // something in the asset's own creation scripts threw — the
              // list makes the report actionable.
              toast.info(
                visibleTypes.length === 0
                  ? 'hython saw no DazToHue node types — the DazToHue otls did not load (check the Houdini documents folder in Settings).'
                  : `hython saw ${visibleTypes.length} DazToHue node types but could not create the network — please report: ${visibleTypes.join(', ')}`,
              )
            }
          }}
        />
      )}

      {pendingRemove && (
        <RemoveAssetDialog
          title="Remove Houdini project?"
          description={
            managedProject(pendingRemove)
              ? 'This project was generated by the studio. With "Keep houdini files" on it is only unlinked; turned off, the scene file AND the Houdini project folder (including its dth-export) are deleted from disk.'
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
  onClose,
  onGenerated,
}: {
  projectId: string
  character: Character
  projectName: string
  onClose: () => void
  /** Links the generated `.hiplc` (the caller owns the persist + toast). */
  onGenerated: (
    scenePath: string,
    networkAdded: boolean,
    visibleTypes: Array<string>,
  ) => Promise<void>
}) {
  const [name, setName] = useState(defaultHoudiniProjectFolder(projectName, character.name))
  const [busy, setBusy] = useState(false)
  const exportDir = displayPath(character.exportPath.trim())
  const projectFolder = character.houdiniProjectFolder.trim()

  async function onGenerate() {
    setBusy(true)
    try {
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
            Creates a new Houdini scene with the DazToHue network (instantiated from your
            installed DazToHue HDA — always the current version) and <em>Set Project</em> baked
            to the character&apos;s Houdini project folder — every import resolves as{' '}
            <code>$JOB/dth-export/…</code>, so the project stays moveable. Runs Houdini&apos;s{' '}
            <code>hython</code>; the first start can take a moment.
          </InfoPopup>
        </span>
      }
      dismissible={!busy}
    >
      <p className="text-xs text-muted-foreground">
        Saves <code>{(name.trim() || '<name>') + '.hiplc'}</code> into <code>{exportDir}</code>,
        next to the project folder <code>{projectFolder}</code> it Set-Projects into — with the
        DazToHue network ready to go.
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
            if (e.key === 'Enter' && name.trim() !== '' && !busy) void onGenerate()
          }}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" className="mr-auto" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy || name.trim() === ''}
          title={name.trim() === '' ? 'The project name cannot be empty' : undefined}
          onClick={() => void onGenerate()}
        >
          <Sparkles /> {busy ? 'Generating…' : 'Generate'}
        </Button>
      </div>
    </Modal>
  )
}
