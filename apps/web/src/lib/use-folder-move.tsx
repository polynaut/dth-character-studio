import { useRef, useState } from 'react'

import { Button, Modal } from '@dth/ui'
import { LockedFilesError } from '#/lib/rom/api.ts'
import { displayPath } from '#/lib/path.ts'

/**
 * The one place every "move a folder" flow shares its robust behaviour: run a
 * move operation, and if it fails because files are open in Daz Studio / Houdini
 * ({@link LockedFilesError}), show a dialog listing the blocked files with
 * **Continue** (re-run the move once the apps are closed) and **Cancel**. Any
 * other error propagates to the caller unchanged.
 *
 * Usage:
 * ```
 * const { runMove, dialog } = useFolderMove()
 * // …
 * await runMove(() => moveCharacter({ data: { … } }))
 * // render {dialog} somewhere
 * ```
 */
export function useFolderMove() {
  const [blocked, setBlocked] = useState<Array<string> | null>(null)
  // Resolves the in-flight "await the user's dialog choice" promise.
  const decideRef = useRef<((choice: 'retry' | 'cancel') => void) | null>(null)

  /** Run `op`, retrying after the locked-files dialog's Continue. Resolves
   *  'done' when the move completed, 'cancelled' when the user cancelled the
   *  dialog. Non-lock errors reject (the caller handles them, e.g. a toast). */
  async function runMove(op: () => Promise<unknown>): Promise<'done' | 'cancelled'> {
    for (;;) {
      try {
        await op()
        return 'done'
      } catch (e) {
        if (!(e instanceof LockedFilesError)) throw e
        setBlocked(e.files)
        const choice = await new Promise<'retry' | 'cancel'>((resolve) => {
          decideRef.current = resolve
        })
        setBlocked(null)
        decideRef.current = null
        if (choice === 'cancel') return 'cancelled'
        // retry: loop and re-run op (which re-probes the locks)
      }
    }
  }

  const dialog = (
    <Modal
      open={blocked !== null}
      onClose={() => decideRef.current?.('cancel')}
      title="Some files are still open"
      showClose={false}
    >
      <p className="text-sm text-muted-foreground">
        These files can’t be moved because they’re still open. Close all Daz&nbsp;Studio and
        Houdini instances, then press Continue.
      </p>
      {blocked && blocked.length > 0 && (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
          {blocked.map((f) => (
            <li key={f} className="truncate" title={f}>
              {displayPath(f)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline-destructive" onClick={() => decideRef.current?.('cancel')}>
          Cancel
        </Button>
        <Button onClick={() => decideRef.current?.('retry')}>Continue</Button>
      </div>
    </Modal>
  )

  return { runMove, dialog }
}
