import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { ExternalLink, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { PathCode, pathChipClass } from '#/components/path-code.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { Button, InfoPopup, Label, RemoveAssetDialog, useModifierHeld } from '@dth/ui'
import houdiniLogo from '#/assets/houdini-logo.svg'
import { openScene, revealPath, saveCharacter } from '#/lib/rom/api.ts'
import { pickHipPath } from '#/lib/desktop.ts'
import { displayPath, pathSeparator } from '#/lib/path.ts'

import type { CharacterLocation } from '#/lib/rom/api.ts'
import type { Character } from '@dth/rom'

/** A linked Houdini project: the Houdini logo (no preview image), the filename,
 *  and its folder — the whole card opens it in Houdini. Houdini projects are
 *  linked in place (never copied), so the folder is shown in full. */
function HoudiniCard({
  hipPath,
  charFolderAbs,
  avatarSrc,
  onOpen,
  onRemove,
}: {
  hipPath: string
  /** The character's folder; when the project sits inside it, the chip shows
   *  "%CHAR%" in place of that prefix. */
  charFolderAbs: string
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
  // The chip shows the project's folder; when it sits inside the character's own
  // folder, collapse that prefix to "%CHAR%" (like the Daz scene cards).
  const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const hipDir = norm(hipPath).replace(/\/[^/]*$/, '')
  const base = norm(charFolderAbs)
  const inChar =
    !!base &&
    (hipDir.toLowerCase() === base.toLowerCase() ||
      hipDir.toLowerCase().startsWith(base.toLowerCase() + '/'))
  const dir = inChar
    ? '%CHAR%' + hipDir.slice(base.length).split('/').join(pathSeparator())
    : displayPath(hipDir)
  return (
    <div className="group/card relative w-80">
      <button
        type="button"
        onClick={onOpen}
        data-alt-reveal=""
        title="Open in Houdini"
        className="houdini-card group relative flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors"
      >
        <Portrait
          src={avatarSrc}
          name={displayName}
          className="aspect-[3/4] w-14 shrink-0 rounded-md"
          fallbackClassName="text-xl"
        />
        {/* Houdini brand mark, floating bottom-left as a badge on the avatar. */}
        <img
          src={houdiniLogo}
          alt=""
          aria-hidden
          className="pointer-events-none absolute bottom-1 left-1 size-8 object-contain drop-shadow-md"
        />
        <div className="min-w-0 text-xs">
          <div className="truncate text-sm font-medium">{displayName}</div>
          {dir && (
            <code
              className={`${pathChipClass('secondary')} mt-1 inline-block max-w-full truncate align-middle`}
            >
              {dir}
            </code>
          )}
        </div>
        {altHeld ? (
          <FolderOpen className="absolute right-3 bottom-3 size-4 text-muted-foreground transition-colors group-hover:text-houdini-orange" />
        ) : (
          <ExternalLink className="absolute right-3 bottom-3 size-4 text-muted-foreground transition-colors group-hover:text-houdini-orange" />
        )}
      </button>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1.5 right-1.5 size-7 opacity-0 transition-opacity group-hover/card:opacity-100"
          title="Unlink from character"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      )}
    </div>
  )
}

/**
 * The character's Houdini projects — a flat list (no primary / avatar, unlike Daz
 * scenes). Houdini projects are linked in place and never copied: a Houdini DTH
 * project stores absolute import paths for its referenced files, so relocating it
 * would break those references. "Add project" picks a `.hip` and links it as-is.
 */
export function HoudiniProjectsField({
  projectId,
  character,
  location,
  onChanged,
}: {
  projectId: string
  character: Character
  location: CharacterLocation
  onChanged: (character: Character) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A project pending the unlink confirm. Houdini projects are only ever linked
  // in place (absolute import paths forbid copying), so removing is unlink-only —
  // never a file delete, which would hit the user's real .hip.
  const [pendingRemove, setPendingRemove] = useState('')

  const projects = character.houdiniProjects
  const hasProjects = projects.length > 0
  // The character's own folder — projects linked inside it show a "%CHAR%" prefix.
  const charFolder = location.definitionAbs
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .replace(/\/[^/]*$/, '')
  // A Houdini project has no thumbnail — use a gender-based placeholder avatar.
  const placeholderSrc =
    character.gender === 'male' ? '/charPlaceholderMale.png' : '/charPlaceholderFemale.png'

  // Folder chip for the linked projects (the first project's directory):
  // everything through the CHARACTER folder is dimmed — only the actual
  // subfolder ("\houdini") reads bright, matching the Daz scenes chip. A
  // project outside the character folder falls back to the project root.
  const projectRoot = displayPath(location.libraryFolder)
  const charFolderDisplay = displayPath(charFolder)
  const firstHipAbs = displayPath(projects[0] ?? '')
  const hipLastSep = Math.max(firstHipAbs.lastIndexOf('\\'), firstHipAbs.lastIndexOf('/'))
  const projectDir = hipLastSep >= 0 ? firstHipAbs.slice(0, hipLastSep) : ''
  const projectRootLen = projectDir.toLowerCase().startsWith(charFolderDisplay.toLowerCase())
    ? charFolderDisplay.length
    : projectDir.toLowerCase().startsWith(projectRoot.toLowerCase())
      ? projectRoot.length
      : 0
  const projectDirChip = (
    <PathCode path={projectDir}>
      {projectRootLen > 0 && (
        <span className="text-muted-foreground/60">{projectDir.slice(0, projectRootLen)}</span>
      )}
      <span className="text-foreground/80">{projectDir.slice(projectRootLen)}</span>
    </PathCode>
  )

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
  // any already linked. Shared by the Browse button and OS drag-and-drop.
  async function addProjects(paths: Array<string>) {
    const fresh = paths.filter((p) => !character.houdiniProjects.includes(p))
    if (fresh.length === 0) return
    setBusy(true)
    setError('')
    try {
      const next: Character = {
        ...character,
        houdiniProjects: [...character.houdiniProjects, ...fresh],
      }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      onChanged(saved)
      void router.invalidate()
      toast.success(
        fresh.length === 1 ? 'Linked Houdini project' : `Linked ${fresh.length} Houdini projects`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
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
    try {
      const next: Character = {
        ...character,
        houdiniProjects: character.houdiniProjects.filter((p) => p !== hip),
      }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      onChanged(saved)
      setPendingRemove('')
      void router.invalidate()
      toast.success('Unlinked Houdini project')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
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
        <InfoPopup label="Houdini projects — more information">
          Linked in place (not copied) — a Houdini project keeps absolute import paths that a
          copy would break. Drag <code>.hip</code> files here or use the button.
        </InfoPopup>
      </Label>
      {hasProjects && <p className="mb-2 text-xs">{projectDirChip}</p>}
      {hasProjects && (
        <div className="flex flex-wrap items-start gap-3">
          {projects.map((hip, i) => (
            <HoudiniCard
              key={`${hip}-${i}`}
              hipPath={hip}
              charFolderAbs={charFolder}
              avatarSrc={placeholderSrc}
              onOpen={(e) => void onOpen(hip, e)}
              onRemove={() => askRemove(hip)}
            />
          ))}
        </div>
      )}
      <Button
        variant="outline"
        size="sm"
        className={hasProjects ? 'mt-3' : ''}
        disabled={busy}
        onClick={() => void onAddPick()}
      >
        <Plus /> {busy ? 'Linking…' : 'Add project'}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

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
