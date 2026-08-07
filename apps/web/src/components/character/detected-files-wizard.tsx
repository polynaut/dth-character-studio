import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'

import { Button, Label, Modal } from '@dth/ui'
import { PathCode, tallPathChipClass } from '#/components/path-code.tsx'
import { SceneValidationTable } from '#/components/scene-compat.tsx'
import { relinkScene } from '#/lib/rom/api.ts'
import { addScenePatch, primaryLinkPatch, useSceneAddValidation } from '#/lib/scene-add.ts'
import { displayPath, normalizePath } from '#/lib/path.ts'

import type { DetectedFilesResult } from '#/lib/rom/api.ts'
import type { PersistCharacterPatch } from '#/lib/use-character-draft.ts'
import type { Character } from '@dth/rom'

interface WizardItem {
  kind: 'scene' | 'houdini'
  path: string
}

/**
 * The multi-page wizard behind the detected-files banner: one page per new
 * file, Add or Skip (= permanent ignore) each, auto-advancing. The page list is
 * DERIVED from the live `detected` prop minus what this dialog already handled
 * — the detection hook keeps rescanning on focus while the wizard is open, so
 * files saved meanwhile append as pages and files deleted on disk drop out, by
 * construction. Closing the dialog decides nothing: unhandled files stay
 * detected and the banner returns.
 *
 * Scenes are added IN PLACE (they already live where they belong — no
 * copy/subfolder step, unlike the pick/drop flows which may import from
 * outside); a scene-less character gets "Set as primary" (the first link,
 * deriving gender/genesis/GEN exactly like `DazSceneField`'s link flow, via the
 * shared builders in lib/scene-add.ts). Houdini projects link in place always.
 */
export function DetectedFilesWizard({
  projectId,
  character,
  persistPatch,
  detected,
  onIgnore,
  onActed,
  onClose,
}: {
  projectId: string
  character: Character
  persistPatch: PersistCharacterPatch
  detected: DetectedFilesResult
  /** Persist a permanent skip (the hook's `ignore`). */
  onIgnore: (paths: Array<string>) => Promise<void>
  /** After any successful Add/Skip — the hook rescans so `detected` settles. */
  onActed: () => void
  onClose: () => void
}) {
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set())
  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const items: Array<WizardItem> = [
    ...detected.scenes.filter((p) => !handled.has(p)).map((path) => ({ kind: 'scene' as const, path })),
    ...detected.houdini.filter((p) => !handled.has(p)).map((path) => ({ kind: 'houdini' as const, path })),
  ]
  // Acting on the last page (or a file vanishing from disk) shrinks the list —
  // clamp instead of tracking, so Back/Next state can't go stale.
  const page = Math.min(idx, Math.max(0, items.length - 1))
  const current: WizardItem | undefined = items[page]

  // Every page handled (or every file gone) — the wizard's job is done.
  const empty = items.length === 0
  useEffect(() => {
    if (empty) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty])

  // A scene-less character has no primary — the first added scene becomes it.
  const primaryMode = current?.kind === 'scene' && !character.scenePath
  const validation = useSceneAddValidation({
    projectId,
    character,
    scenePath: current?.kind === 'scene' ? current.path : '',
    mode: primaryMode ? 'primary' : 'add',
  })

  function markHandled(path: string) {
    setHandled((prev) => new Set(prev).add(path))
    setError('')
    onActed()
  }

  async function skip() {
    if (!current) return
    setBusy(true)
    setError('')
    try {
      await onIgnore([current.path])
      markHandled(current.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  async function addScene() {
    if (!current) return
    setBusy(true)
    setError('')
    const scene = current.path
    const saved = primaryMode
      ? await persistPatch(() => primaryLinkPatch(scene, character, true, (m) => toast.info(m)), {
          toast: 'Linked Daz scene',
          // relinkScene persists AND derives the avatar from the new primary.
          persist: (updated) =>
            relinkScene({ data: { projectId, character: updated, scenePath: updated.scenePath } }),
        })
      : await persistPatch(() => addScenePatch(scene, character), { toast: 'Added Daz scene' })
    if (saved) markHandled(scene)
    setBusy(false)
  }

  async function addHoudini() {
    if (!current) return
    setBusy(true)
    setError('')
    const hip = current.path
    // Same case-insensitive dedupe as the field's addProjects — a project linked
    // meanwhile (another window) must not link twice.
    const linked = new Set(character.houdiniProjects.map((p) => normalizePath(p).toLowerCase()))
    const saved = linked.has(normalizePath(hip).toLowerCase())
      ? character
      : await persistPatch(
          { houdiniProjects: [...character.houdiniProjects, hip] },
          { toast: 'Linked Houdini project' },
        )
    if (saved) markHandled(hip)
    setBusy(false)
  }

  if (!current) return null
  const isScene = current.kind === 'scene'
  return (
    <Modal
      open
      onClose={onClose}
      title={
        items.length === 1
          ? 'New file found in the character folder'
          : `New files found in the character folder — ${page + 1} of ${items.length}`
      }
      dismissible={!busy}
      className="max-w-3xl"
    >
      <div>
        <Label className="mb-1 block">{isScene ? 'Daz scene' : 'Houdini project'}</Label>
        <PathCode path={displayPath(current.path)} className={tallPathChipClass} />
      </div>
      {isScene ? (
        <SceneValidationTable
          rows={validation.rows}
          loading={validation.checking}
          force={validation.force}
          onForceChange={validation.setForce}
          forceLabel="Add anyway — a failed check usually means the scene's ROM won't match"
          projectId={projectId}
          currentCharacterId={character.id}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Houdini projects are linked in place, never copied — the file stays exactly where you
          saved it.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        {items.length > 1 && (
          <>
            <Button
              variant="outline"
              size="sm"
              aria-label="Previous file"
              disabled={busy || page === 0}
              onClick={() => setIdx(page - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="Next file"
              disabled={busy || page === items.length - 1}
              onClick={() => setIdx(page + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </>
        )}
        <div className="flex-1" />
        <Button variant="ghost" disabled={busy} onClick={() => void skip()}>
          Skip
        </Button>
        <Button
          disabled={busy || (isScene && validation.blocked)}
          title={
            isScene && validation.blocked
              ? validation.checking
                ? 'Checking the scene…'
                : validation.hardBlocked
                  ? 'This scene already belongs to a character — pick a different scene'
                  : 'A validation check failed — see the table above (or flip “Add anyway”)'
              : undefined
          }
          onClick={() => void (isScene ? addScene() : addHoudini())}
        >
          {busy
            ? isScene
              ? 'Adding…'
              : 'Linking…'
            : primaryMode
              ? 'Set as primary'
              : isScene
                ? 'Add scene'
                : 'Add project'}
        </Button>
      </div>
    </Modal>
  )
}
