import { useRef } from 'react'
import { useBlocker } from '@tanstack/react-router'

import { confirmDialog } from '#/lib/desktop.ts'

/**
 * Blocks route navigation while `dirty`, asking the user first — so unsaved
 * edits can't be lost to a stray click on Back / a breadcrumb / the header nav.
 * Also arms the `beforeunload` guard for window close / reload while dirty.
 *
 * Returns `bypass()` for programmatic navigations that must never ask: call it
 * right before navigating away from something that no longer exists (e.g. the
 * editor's post-delete jump) — a "keep your changes?" prompt for a deleted
 * character would be nonsense.
 */
export function useUnsavedChangesGuard(dirty: boolean, message: string) {
  // Refs, not closure state: the blocker registers once but must always see
  // the CURRENT dirty flag when a navigation actually happens.
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const bypassRef = useRef(false)
  useBlocker({
    shouldBlockFn: async () => {
      if (!dirtyRef.current || bypassRef.current) return false
      const leave = await confirmDialog(message, { title: 'Unsaved changes', kind: 'warning' })
      return !leave
    },
    enableBeforeUnload: () => dirtyRef.current && !bypassRef.current,
  })
  return {
    bypass: () => {
      bypassRef.current = true
    },
  }
}
