import { useEffect, useRef } from 'react'
import { useBlocker } from '@tanstack/react-router'

import { confirmDialog, onWindowCloseRequested } from '#/lib/desktop.ts'

/**
 * Blocks route navigation while `dirty`, asking the user first — so unsaved
 * edits can't be lost to a stray click on Back / a breadcrumb / the header nav.
 * Also arms the `beforeunload` guard for reloads (browser build) and intercepts
 * the NATIVE window close in the Tauri shell — the titlebar ✕ never delivers
 * `beforeunload` there, so without the close-request hook a dirty window would
 * just close.
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
  const messageRef = useRef(message)
  messageRef.current = message
  useBlocker({
    shouldBlockFn: async () => {
      if (!dirtyRef.current || bypassRef.current) return false
      // messageRef, not the closure: the blocker registers once, so a changed
      // message would otherwise show its first-render text here forever (the
      // window-close path below already reads the ref).
      const leave = await confirmDialog(messageRef.current, {
        title: 'Unsaved changes',
        kind: 'warning',
      })
      return !leave
    },
    enableBeforeUnload: () => dirtyRef.current && !bypassRef.current,
  })
  useEffect(() => {
    // Tauri holds the close while the (possibly async) handler runs and only
    // destroys the window if preventDefault wasn't called — so awaiting the
    // dialog here is the supported shape. `asking` blocks further ✕ clicks
    // from stacking a second dialog while the first is open.
    let asking = false
    return onWindowCloseRequested(async (event) => {
      if (!dirtyRef.current || bypassRef.current) return
      if (asking) {
        event.preventDefault()
        return
      }
      asking = true
      try {
        const leave = await confirmDialog(messageRef.current, {
          title: 'Unsaved changes',
          kind: 'warning',
        })
        if (!leave) event.preventDefault()
      } finally {
        asking = false
      }
    })
  }, [])
  return {
    bypass: () => {
      bypassRef.current = true
    },
  }
}
