import { useState } from 'react'
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
  RemoveAssetDialog,
  useModifierHeld,
} from '@dth/ui'
import houdiniLogo from '#/assets/houdini-logo.svg'
import { generateHoudiniProject, openScene, revealPath } from '#/lib/rom/api.ts'
import { pickHipPath } from '#/lib/desktop.ts'
import { displayPath, normalizePath, parentDir } from '#/lib/path.ts'
import { defaultHoudiniProjectFolder } from '@dth/rom'

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
  // A project pending the unlink confirm. Houdini projects are only ever linked
  // in place (absolute import paths forbid copying), so removing is unlink-only —
  // never a file delete, which would hit the user's real .hip.
  const [pendingRemove, setPendingRemove] = useState('')

  const projects = character.houdiniProjects
  const hasProjects = projects.length > 0
  const canGenerate =
    character.exportPath.trim() !== '' && character.houdiniProjectFolder.trim() !== ''
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

  function askRemove(hip: string) {
    setError('')
    setPendingRemove(hip)
  }

  async function confirmRemove() {
    const hip = pendingRemove
    setBusy(true)
    setError('')
    const saved = await persistPatch(
      { houdiniProjects: character.houdiniProjects.filter((p) => p !== hip) },
      { toast: 'Unlinked Houdini project' },
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
      {hasProjects && (
        <div className="flex flex-wrap items-start gap-3">
          {projects.map((hip) => (
            <HoudiniCard
              key={hip}
              hipPath={hip}
              avatarSrc={placeholderSrc}
              onOpen={(e) => void onOpen(hip, e)}
              onRemove={() => askRemove(hip)}
            />
          ))}
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
          onGenerated={(scenePath) =>
            addProjects([scenePath], 'Houdini project generated — DazToHue network and Set Project are baked in')
          }
        />
      )}

      {pendingRemove && (
        <RemoveAssetDialog
          title="Remove Houdini project?"
          description="Unlink this Houdini project from the character."
          showDeleteFile={false}
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
 * project — template loaded, `$JOB` baked to the character's
 * `<export dir>/<Houdini project folder>` (the programmatic File → Set
 * Project), saved as `<name>.hiplc` at that folder's root — and the new scene
 * is linked as a Houdini project card. Needs the Houdini installation folder
 * and the DazToHue template scene in Settings (api/houdini.ts reports either
 * gap as a precise error).
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
  onGenerated: (scenePath: string) => Promise<void>
}) {
  const [name, setName] = useState(defaultHoudiniProjectFolder(projectName, character.name))
  const [busy, setBusy] = useState(false)
  const projectDir = displayPath(
    `${character.exportPath.trim().replace(/\\/g, '/')}/${character.houdiniProjectFolder.trim()}`,
  )

  async function onGenerate() {
    setBusy(true)
    try {
      const result = await generateHoudiniProject({
        data: { projectId, id: character.id, sceneName: name },
      })
      await onGenerated(result.scenePath)
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
            Creates a new Houdini scene from your DazToHue template (Settings), with{' '}
            <em>Set Project</em> baked to the character&apos;s Houdini project folder — every
            import resolves as <code>$JOB/dth-export/…</code>, so the project stays moveable.
            Runs Houdini&apos;s <code>hython</code>; the first start can take a moment.
          </InfoPopup>
        </span>
      }
      dismissible={!busy}
    >
      <p className="text-xs text-muted-foreground">
        Saves <code>{(name.trim() || '<name>') + '.hiplc'}</code> into <code>{projectDir}</code>{' '}
        with the DazToHue network ready to go.
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
