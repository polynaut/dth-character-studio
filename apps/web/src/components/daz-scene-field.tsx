import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from '@tanstack/react-router'
import { ExternalLink, FolderInput, FolderOpen, Link2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { PathCode, pathChipClass } from '#/components/path-code.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { Tag } from '#/components/tag.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { RemoveAssetDialog } from '#/components/remove-asset-dialog.tsx'
import { SceneCopyDialog } from '#/components/scene-copy-dialog.tsx'
import { Button } from '#/components/ui/button.tsx'
import { Input } from '#/components/ui/input.tsx'
import { Label } from '#/components/ui/label.tsx'
import dazLogo from '#/assets/daz-logo.png'
import {
  copyDazScene,
  deleteFiles,
  moveCharacterScenesFolder,
  openScene,
  revealPath,
  relinkScene,
  saveCharacter,
} from '#/lib/rom/api.ts'
import { pickDufPath, pickFolder } from '#/lib/desktop.ts'
import { useModifierHeld } from '#/lib/use-modifier-held.ts'
import { displayPath, pathSeparator } from '#/lib/path.ts'

import type { CharacterLocation } from '#/lib/rom/api.ts'
import type { Character } from '@dth/rom'

/**
 * A linked Daz scene as a clickable card — its `.tip.png` portrait, the
 * filename, and the Daz badge; clicking the whole card opens the scene in Daz.
 */
function SceneCard({
  scenePath,
  name,
  charFolderAbs,
  onOpen,
  onRemove,
  primary,
}: {
  scenePath: string
  name: string
  /** The character's folder; the scene's path relative to it (incl. the daz
   *  scenes folder) is shown as a chip, e.g. "%CHAR%\daz3d\Outfit_Summertide\". */
  charFolderAbs: string
  onOpen: (e: React.MouseEvent) => void
  /** When set, a hover ✕ unlinks the scene from the character (file is kept). */
  onRemove?: () => void
  /** The character's original creation scene — gets a "primary" badge and is not
   *  unlinkable (the caller omits onRemove). */
  primary?: boolean
}) {
  const fileName = scenePath.split(/[\\/]/).pop() ?? scenePath
  // The heading shows the scene name without its extension (e.g. ".duf").
  const displayName = fileName.replace(/\.[^./\\]+$/, '')
  // Alt held → the open icon previews the alternate action (show in Explorer).
  const altHeld = useModifierHeld('Alt')
  // The scene's folder relative to the character folder — e.g. "daz3d" for a
  // scene directly in the scenes folder, or "daz3d/Outfit_Summertide" when
  // nested. Empty for a scene linked outside the character folder.
  const norm = (p: string) => p.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const sceneDir = norm(scenePath).replace(/\/[^/]*$/, '')
  const base = norm(charFolderAbs)
  const relSub =
    base && sceneDir.toLowerCase().startsWith(base.toLowerCase() + '/')
      ? sceneDir.slice(base.length + 1)
      : ''
  return (
    <div className="group/card relative w-80">
      <button
        type="button"
        onClick={onOpen}
        title="Open in Daz"
        className="daz-card group relative flex h-full w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors"
      >
        <Portrait
          scenePath={scenePath}
          name={name}
          className="aspect-[3/4] w-14 shrink-0 rounded-md"
          fallbackClassName="text-xl"
        />
        {/* Daz brand mark, floating bottom-left as a badge on the portrait. */}
        <img
          src={dazLogo}
          alt=""
          aria-hidden
          className="pointer-events-none absolute bottom-1 left-1 size-8 object-contain drop-shadow-md"
        />
        <div className="min-w-0 text-xs">
          <div className="truncate text-sm font-medium">{displayName}</div>
          {relSub && (
            <code
              className={`${pathChipClass('secondary')} mt-1 inline-block max-w-full truncate align-middle`}
            >
              {`%CHAR%${pathSeparator()}${displayPath(relSub)}${pathSeparator()}`}
            </code>
          )}
          {primary && (
            <div className="mt-1">
              <Tag tone="green" title="The character's original scene — it can't be unlinked">
                primary
              </Tag>
            </div>
          )}
        </div>
        {altHeld ? (
          <FolderOpen className="absolute right-3 bottom-3 size-4 text-muted-foreground transition-colors group-hover:text-daz-green" />
        ) : (
          <ExternalLink className="absolute right-3 bottom-3 size-4 text-muted-foreground transition-colors group-hover:text-daz-green" />
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
  onLinked,
}: {
  projectId: string
  character: Character
  location: CharacterLocation
  sceneExists: boolean
  sceneFolderExists: boolean
  defaultSubdir: string
  onLinked: (character: Character) => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A picked scene outside the project pauses here awaiting the copy decision.
  const [pending, setPending] = useState('')
  const [subfolder, setSubfolder] = useState(() => defaultSubdir)
  // A picked *additional* scene awaiting its copy decision — separate from the
  // primary link flow. Its subfolder nests inside the existing scenes folder.
  const [pendingAdd, setPendingAdd] = useState('')
  const [addSubfolder, setAddSubfolder] = useState('')
  // When on, the source scene is deleted after copying (a move). Off by default;
  // mutually exclusive with "Link in place" (which keeps the original in place).
  const [deleteOriginal, setDeleteOriginal] = useState(false)
  // A scene pending the unlink confirm + whether to also delete it from disk.
  const [pendingRemove, setPendingRemove] = useState('')
  const [removeDeleteFile, setRemoveDeleteFile] = useState(false)
  // Editing the scenes subfolder (the chip's pencil): null = not editing,
  // otherwise the draft value relative to the character folder.
  const [editDir, setEditDir] = useState<string | null>(null)

  // Esc closes the primary link modal (the Add modal is a SceneCopyDialog, which
  // wires its own Esc). This one isn't a Radix dialog, so it's by hand; ignored
  // while a copy is in flight.
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setPending('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, busy])

  const linked = Boolean(character.scenePath)
  const ready = linked && sceneExists
  // The whole scenes folder is gone (renamed/moved outside the app) — offer to
  // re-link it, which re-points every scene path to the folder's new location.
  const folderMissing = linked && !sceneFolderExists

  const norm = (s: string) => s.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  function insideProject(p: string): boolean {
    return norm(p).toLowerCase().startsWith(norm(location.libraryFolder).toLowerCase() + '/')
  }
  // The character's own folder, and the primary scene's folder relative to it
  // (e.g. "daz3d") — added scenes are copied there; the modal subdir nests inside.
  const charFolder = norm(location.definitionAbs).replace(/\/[^/]*$/, '')
  function insideCharFolder(p: string): boolean {
    return norm(p).toLowerCase().startsWith(charFolder.toLowerCase() + '/')
  }
  // Every scene already attached to this character (primary + extras). A scene is
  // linked at most once, so a pick/drop that repeats one is rejected up front.
  const linkedScenes = [character.scenePath, ...character.extraScenes].filter(Boolean)
  function isAlreadyLinked(p: string): boolean {
    const target = norm(p).toLowerCase()
    return linkedScenes.some((s) => norm(s).toLowerCase() === target)
  }
  const primaryDir = character.scenePath ? norm(character.scenePath).replace(/\/[^/]*$/, '') : ''
  const baseDazRel =
    primaryDir && primaryDir.toLowerCase().startsWith(charFolder.toLowerCase() + '/')
      ? primaryDir.slice(charFolder.length + 1)
      : defaultSubdir
  const cleanSub = (s: string) => s.split(/[\\/]+/).filter(Boolean).join('/')

  // Alt+click = the app-wide "show in Explorer" hotkey (same as path chips
  // and the Unreal cards); plain click opens the scene in Daz.
  async function onOpen(scenePath: string, e?: React.MouseEvent) {
    setError('')
    try {
      if (e?.altKey) await revealPath({ data: { path: scenePath } })
      else await openScene({ data: { scenePath } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      toast.error(e?.altKey ? msg : `Couldn't open in Daz: ${msg}`)
    }
  }

  // The scenes folder was renamed/moved on disk. Pick its new location (opening
  // in the character folder) and re-point every scene path under the old folder
  // to the new one, preserving each scene's relative subpath.
  async function onRelinkFolder() {
    const picked = await pickFolder('Select the Daz scenes folder', charFolder)
    if (!picked) return
    setBusy(true)
    setError('')
    try {
      const oldBase = norm(character.scenePath).replace(/\/[^/]*$/, '')
      const newBase = norm(picked)
      const repoint = (p: string) => {
        const rel = norm(p)
        return rel.toLowerCase().startsWith(oldBase.toLowerCase() + '/')
          ? `${newBase}/${rel.slice(oldBase.length + 1)}`
          : p // a scene linked outside the folder is left untouched
      }
      const next: Character = {
        ...character,
        scenePath: repoint(character.scenePath),
        extraScenes: character.extraScenes.map(repoint),
      }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      onLinked(saved)
      void router.invalidate()
      toast.success('Relinked the Daz scenes folder')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onAddPick() {
    const picked = await pickDufPath('Select another Daz scene (.duf)')
    if (!picked) return
    if (!insideCharFolder(picked)) {
      setAddSubfolder('')
      setDeleteOriginal(false)
      setPendingAdd(picked)
      return
    }
    await applyAdd(picked, false)
  }

  async function applyAdd(scene: string, copyInto: boolean) {
    const sceneName = scene.split(/[\\/]/).pop() ?? scene
    const subfolder = [baseDazRel, cleanSub(addSubfolder)].filter(Boolean).join('/')
    // Reject a scene that's already attached, before any copy runs. An in-place add
    // compares the picked path itself; a copy compares its destination inside the
    // character folder — which catches re-copying the same external scene (its source
    // path differs from the in-folder copy, but the destination collides, which would
    // otherwise overwrite the existing copy and add a duplicate card). Checking up
    // front also means a `deleteOriginal` move never deletes the source then bails.
    const dest = copyInto ? [charFolder, subfolder, sceneName].filter(Boolean).join('/') : scene
    if (isAlreadyLinked(dest)) {
      toast.error(`“${sceneName}” is already linked to this character.`)
      return
    }
    setBusy(true)
    setError('')
    try {
      const finalScene = copyInto
        ? await copyDazScene({
            data: {
              projectId,
              characterId: character.id,
              scenePath: scene,
              subfolder,
              deleteOriginal,
            },
          })
        : scene
      const next: Character = { ...character, extraScenes: [...character.extraScenes, finalScene] }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      onLinked(saved)
      setPendingAdd('')
      void router.invalidate()
      toast.success('Added Daz scene')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
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
    try {
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
      const saved = await relinkScene({ data: { projectId, character, scenePath: finalScene } })
      onLinked(saved)
      setPending('')
      void router.invalidate()
      toast.success('Linked Daz scene')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
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
      if (!insideCharFolder(scene)) {
        setAddSubfolder('')
        setDeleteOriginal(false)
        setPendingAdd(scene)
        return
      }
      void applyAdd(scene, false)
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
    try {
      if (removeDeleteFile) {
        const noDuf = scene.replace(/\.duf$/i, '')
        await deleteFiles({
          data: { paths: [scene, `${scene}.png`, `${scene}.tip.png`, `${noDuf}.tip.png`] },
        })
      }
      // Collapse the scene list (primary + extras), promoting the first remaining
      // scene to primary when the primary itself was removed.
      const all = [character.scenePath, ...character.extraScenes].filter(Boolean)
      const remaining = all.filter((s) => s !== scene)
      const next: Character = {
        ...character,
        scenePath: remaining[0] ?? '',
        extraScenes: remaining.slice(1),
      }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      onLinked(saved)
      setPendingRemove('')
      void router.invalidate()
      toast.success(removeDeleteFile ? 'Deleted Daz scene' : 'Unlinked Daz scene')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Two-tone path chip for the scenes' folder (the primary scene's directory):
  // everything through the CHARACTER folder is dimmed — we're already inside the
  // character here, so only the actual scenes subfolder ("\daz3d") reads bright.
  // A scene outside the character folder falls back to dimming the project root.
  const sceneAbs = displayPath(character.scenePath)
  const projectRoot = displayPath(location.libraryFolder)
  const charFolderDisplay = displayPath(charFolder)
  const lastSep = Math.max(sceneAbs.lastIndexOf('\\'), sceneAbs.lastIndexOf('/'))
  const sceneDir = lastSep >= 0 ? sceneAbs.slice(0, lastSep) : ''
  const dirRootLen = sceneDir.toLowerCase().startsWith(charFolderDisplay.toLowerCase())
    ? charFolderDisplay.length
    : sceneDir.toLowerCase().startsWith(projectRoot.toLowerCase())
      ? projectRoot.length
      : 0
  // The scenes subfolder relative to the character folder ('' when the scene is
  // linked from outside it) — that's the editable part of the chip.
  const sceneDirAbs = norm(character.scenePath).replace(/\/[^/]*$/, '')
  const sceneDirRel = insideCharFolder(character.scenePath)
    ? sceneDirAbs.slice(charFolder.length + 1)
    : ''
  const sceneDirChip = (
    <PathCode
      path={sceneDir}
      onEdit={sceneDirRel && !busy ? () => setEditDir(displayPath(sceneDirRel)) : undefined}
    >
      {dirRootLen > 0 && (
        <span className="text-muted-foreground/60">{sceneDir.slice(0, dirRootLen)}</span>
      )}
      <span className="text-foreground/80">{sceneDir.slice(dirRootLen)}</span>
    </PathCode>
  )

  async function onMoveScenesDir() {
    if (editDir === null || !editDir.trim()) return
    setBusy(true)
    setError('')
    try {
      const saved = await moveCharacterScenesFolder({
        data: { projectId, id: character.id, newSubdir: editDir },
      })
      onLinked(saved)
      setEditDir(null)
      void router.invalidate()
      toast.success('Moved the Daz scenes folder')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <FileDropZone
      accept={['duf']}
      onDrop={onDropScene}
      label={linked ? 'Drop a Daz scene (.duf) to add' : 'Drop a Daz scene (.duf) to link'}
      className="rounded-lg"
    >
      <Label className="mb-1 block">Daz scenes</Label>
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
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditDir(null)}>
                  Cancel
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-stretch gap-3">
              {ready ? (
                <SceneCard
                  scenePath={character.scenePath}
                  name={character.name}
                  charFolderAbs={charFolder}
                  onOpen={(e) => void onOpen(character.scenePath, e)}
                  primary
                />
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-destructive/50 p-3 py-8 text-sm text-muted-foreground">
                  Primary scene missing.
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void onPick()}>
                    <Link2 /> Relink
                  </Button>
                </div>
              )}
              {character.extraScenes.map((scene, i) => (
                <SceneCard
                  key={`${scene}-${i}`}
                  scenePath={scene}
                  name={character.name}
                  charFolderAbs={charFolder}
                  onOpen={(e) => void onOpen(scene, e)}
                  onRemove={() => askRemove(scene)}
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

      {pending &&
        createPortal(
        // Portaled to <body> — see ImageDialog — so the contained editor body
        // doesn't become this fixed overlay's containing block.
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => !busy && setPending('')}
        >
          <div
            className="w-full max-w-md space-y-4 rounded-lg border bg-background p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Copy the Daz scene into the project?</h2>
            <p className="text-sm text-muted-foreground">
              The selected scene lives outside this project. Copy it into the
              character's folder?
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
          </div>
        </div>,
        document.body,
      )}

      {pendingAdd && (
        <SceneCopyDialog
          title="Add Daz scene to the character?"
          description="The selected scene lives outside the character folder. Copy it into the character folder?"
          prefix={displayPath(`${baseDazRel}/`)}
          subfolder={addSubfolder}
          onSubfolderChange={setAddSubfolder}
          deleteOriginal={deleteOriginal}
          onDeleteOriginalChange={setDeleteOriginal}
          busy={busy}
          error={error}
          copyLabel="Copy & add"
          onCopy={() => void applyAdd(pendingAdd, true)}
          onLink={() => void applyAdd(pendingAdd, false)}
          onClose={() => setPendingAdd('')}
        />
      )}

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
    </FileDropZone>
  )
}
