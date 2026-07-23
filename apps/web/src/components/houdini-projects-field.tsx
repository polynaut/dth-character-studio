import { useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'

import { pathChipClass } from '#/components/path-code.tsx'
import { DirPathChip, displayDirOf } from '#/components/dir-path-chip.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { Button, InfoPopup, Label, LinkedAssetCard, RemoveAssetDialog, useModifierHeld } from '@dth/ui'
import houdiniLogo from '#/assets/houdini-logo.svg'
import { openScene, revealPath } from '#/lib/rom/api.ts'
import { pickHipPath } from '#/lib/desktop.ts'
import { displayPath, normalizePath, parentDir, pathSeparator } from '#/lib/path.ts'

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
  const hipDir = parentDir(hipPath)
  const base = normalizePath(charFolderAbs)
  const inChar =
    !!base &&
    (hipDir.toLowerCase() === base.toLowerCase() ||
      hipDir.toLowerCase().startsWith(base.toLowerCase() + '/'))
  const dir = inChar
    ? '%CHAR%' + hipDir.slice(base.length).split('/').join(pathSeparator())
    : displayPath(hipDir)
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
      chip={
        dir ? (
          <code
            className={`${pathChipClass('secondary')} inline-block max-w-full truncate align-middle`}
          >
            {dir}
          </code>
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
}: {
  character: Character
  location: CharacterLocation
  /** The draft hook's immediate-persist primitive — link/unlink go through it
   *  so validation, single-flight and regeneration are never skipped. */
  persistPatch: PersistCharacterPatch
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A project pending the unlink confirm. Houdini projects are only ever linked
  // in place (absolute import paths forbid copying), so removing is unlink-only —
  // never a file delete, which would hit the user's real .hip.
  const [pendingRemove, setPendingRemove] = useState('')

  const projects = character.houdiniProjects
  const hasProjects = projects.length > 0
  // The character's own folder — projects linked inside it show a "%CHAR%" prefix.
  const charFolder = parentDir(location.definitionAbs)
  // A Houdini project has no thumbnail — use a gender-based placeholder avatar.
  const placeholderSrc =
    character.gender === 'male' ? '/charPlaceholderMale.png' : '/charPlaceholderFemale.png'

  // Folder chip for the linked projects (the first project's directory):
  // everything through the CHARACTER folder is dimmed — only the actual
  // subfolder ("\houdini") reads bright, matching the Daz scenes chip. A
  // project outside the character folder falls back to the project root.
  const projectDirChip = (
    <DirPathChip
      dir={displayDirOf(projects[0] ?? '')}
      roots={[displayPath(charFolder), displayPath(location.libraryFolder)]}
    />
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
          fresh.length === 1 ? 'Linked Houdini project' : `Linked ${fresh.length} Houdini projects`,
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
      {hasProjects && <p className="mb-2 text-xs">{projectDirChip}</p>}
      {hasProjects && (
        <div className="flex flex-wrap items-start gap-3">
          {projects.map((hip) => (
            <HoudiniCard
              key={hip}
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
