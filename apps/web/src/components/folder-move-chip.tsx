import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button, Input } from '@dth/ui'
import { DirPathChip } from '#/components/dir-path-chip.tsx'
import { menuSurfaceClass } from '#/components/rom/cells.tsx'

/**
 * A {@link DirPathChip} with an edit-to-move affordance — the shared UX behind
 * "move this folder/scene" everywhere it appears (the character header's folder
 * chip, the project overview's project-folder chip, the Daz scenes chips). The
 * pencil opens a FLOATING one-line panel right under the chip — dropdown-menu
 * styled, like the autocomplete list — so the chip stays visible while
 * editing. Move calls `onMove(nextValue)` (the caller does the real filesystem
 * move; a throw toasts and keeps the panel open); Cancel, Escape or a click
 * outside closes it.
 *
 * The editable value's meaning is the caller's — a subfolder for a character,
 * an absolute folder path for a project — so this component only owns the edit
 * state and the Move/Cancel controls; it never interprets the value.
 */
export function FolderMoveChip({
  dir,
  roots,
  copyPath,
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
  /** What a click copies when it differs from the displayed `dir` (see DirPathChip). */
  copyPath?: string
  /** Seed for the edit input (what "moving" changes — a subfolder or a path). */
  editValue: string
  /** Small label before the input, e.g. "Folder" / "Move to". */
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
  const rootRef = useRef<HTMLSpanElement>(null)

  // Menu-like dismissal: a press outside the chip + panel closes the editor
  // (Escape and Cancel do too) — never mid-move.
  useEffect(() => {
    if (draft === null) return
    function onPointerDown(e: PointerEvent) {
      if (busy) return
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) {
        setDraft(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [draft, busy])

  const trimmed = (draft ?? '').trim()
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
    <span ref={rootRef} className="relative inline-flex max-w-full">
      <DirPathChip
        dir={dir}
        roots={roots}
        copyPath={copyPath}
        // The pencil toggles the panel, like a dropdown trigger.
        onEdit={disabled ? undefined : () => setDraft(draft === null ? editValue : null)}
      />
      {draft !== null && (
        // Floating one-line editor on the SAME raised surface the autocomplete
        // menus use (menuSurfaceClass), anchored under the chip.
        <div
          className={`absolute top-full left-0 z-50 mt-1 flex w-max items-center gap-2 p-2 ${menuSurfaceClass}`}
        >
          <span className="text-xs whitespace-nowrap text-muted-foreground">{editLabel}:</span>
          <Input
            value={draft}
            autoFocus
            disabled={busy}
            // bg-muted: recessed against the panel's RAISED surface — the
            // default input fill blends into it.
            className={`h-7 ${inputWidthClass} bg-muted font-mono text-xs`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void move()
              if (e.key === 'Escape') setDraft(null)
            }}
          />
          <Button variant="outline" size="sm" disabled={!canMove} onClick={() => void move()}>
            {busy ? 'Moving…' : 'Move'}
          </Button>
          <Button
            variant="outline-destructive"
            size="sm"
            disabled={busy}
            onClick={() => setDraft(null)}
          >
            Cancel
          </Button>
        </div>
      )}
    </span>
  )
}
