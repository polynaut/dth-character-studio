import { useState } from 'react'
import { toast } from 'sonner'

import { Button, Input } from '@dth/ui'
import { DirPathChip } from '#/components/dir-path-chip.tsx'

/**
 * A {@link DirPathChip} with an inline edit-to-move affordance — the shared UX
 * behind "move this folder" everywhere it appears (the character header's folder
 * chip, the project overview's project-folder chip, mirroring the Daz scenes
 * subfolder editor). The pencil swaps the chip for an input seeded with
 * `editValue`; Move calls `onMove(nextValue)` (the caller does the real
 * filesystem move), Cancel or Esc restores the chip.
 *
 * The editable value's meaning is the caller's — a subfolder for a character, an
 * absolute folder path for a project — so this component only owns the edit
 * state and the Move/Cancel controls; it never interprets the value.
 */
export function FolderMoveChip({
  dir,
  roots,
  editValue,
  editLabel,
  inputWidthClass = 'w-64',
  onMove,
  disabled,
}: {
  /** Display-formatted directory shown in the chip (see DirPathChip). */
  dir: string
  /** Display-formatted candidate roots, most specific first (dimmed prefix). */
  roots: Array<string>
  /** Seed for the edit input (what "moving" changes — a subfolder or a path). */
  editValue: string
  /** Small label before the input, e.g. "Folder" / "Project folder". */
  editLabel: string
  /** Tailwind width for the input (paths need more room than a subfolder). */
  inputWidthClass?: string
  /** Perform the move to `next`; throwing surfaces a toast and keeps editing.
   *  The resolved value is ignored (callers may return a move outcome). */
  onMove: (next: string) => Promise<unknown>
  /** Hide the pencil (e.g. while another operation is in flight). */
  disabled?: boolean
}) {
  // null = not editing; otherwise the draft input value.
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (draft === null) {
    return (
      <DirPathChip dir={dir} roots={roots} onEdit={disabled ? undefined : () => setDraft(editValue)} />
    )
  }

  const trimmed = draft.trim()
  const canMove = !busy && !!trimmed && trimmed !== editValue.trim()

  async function move() {
    if (!canMove) return
    setBusy(true)
    try {
      await onMove(trimmed)
      setDraft(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground">{editLabel}:</span>
      <Input
        value={draft}
        autoFocus
        disabled={busy}
        className={`h-7 ${inputWidthClass} font-mono text-xs`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void move()
          if (e.key === 'Escape') setDraft(null)
        }}
      />
      <Button variant="outline" size="sm" disabled={!canMove} onClick={() => void move()}>
        {busy ? 'Moving…' : 'Move'}
      </Button>
      <Button variant="outline-destructive" size="sm" disabled={busy} onClick={() => setDraft(null)}>
        Cancel
      </Button>
    </span>
  )
}
