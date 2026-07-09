import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useRouter } from '@tanstack/react-router'
import { FolderInput } from 'lucide-react'
import { toast } from 'sonner'

import { Button, Field, Input } from '@dth/ui'
import { moveCharacter } from '#/lib/rom/api.ts'
import { displayPath } from '#/lib/path.ts'

import type { CharacterLocation } from '#/lib/rom/api.ts'
import type { Character } from '@dth/rom'

/** Shows where a character's folder lives and lets the user move it within the library. */
export function StorageLocation({
  projectId,
  id,
  location,
  onMoved,
}: {
  projectId: string
  id: string
  location: CharacterLocation | null
  onMoved: (character: Character) => void
}) {
  const router = useRouter()
  const [subdir, setSubdir] = useState(() => displayPath(location?.relFolder ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!location) return null

  // Only the subdirectory is editable — the definition keeps its current filename,
  // which follows the character name (renaming the character renames it). The
  // subdirectory may nest (a/b/c) but is required (each character owns a folder).
  const clean = (s: string) => s.split(/[\\/]+/).filter(Boolean).join('/')
  const subdirForward = clean(subdir)
  const currentSubdir = clean(location.relFolder)
  const fileName = location.definitionAbs.split(/[\\/]/).pop() ?? ''

  const subdirError = !subdirForward ? 'A subdirectory is required.' : ''
  const changed = subdirForward !== currentSubdir
  const canMove = Boolean(subdirForward) && changed && !busy

  async function onMove() {
    if (!canMove) return
    // Keep the current filename (it follows the character name); just move the
    // folder. The backend normalizes separators again.
    const relPath = `${subdirForward}/${fileName}`
    setBusy(true)
    setError('')
    try {
      const { character } = await moveCharacter({ data: { projectId, id, relPath } })
      await router.invalidate()
      onMoved(character)
      toast.success(`Moved to ${displayPath(relPath)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onEnter = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void onMove()
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start gap-2">
        <Field label="Character directory" error={subdirError} className="min-w-[9rem] flex-1">
          <Input
            value={subdir}
            placeholder={displayPath('Aria_G9')}
            aria-invalid={subdirError ? true : undefined}
            onChange={(e) => setSubdir(e.target.value)}
            onKeyDown={onEnter}
          />
        </Field>
        <Field className="shrink-0">
          <Button variant="outline" onClick={onMove} disabled={!canMove}>
            <FolderInput /> Move
          </Button>
        </Field>
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
