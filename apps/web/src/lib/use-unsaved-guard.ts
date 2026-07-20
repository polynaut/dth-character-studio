import { useCallback, useEffect, useRef } from 'react'
import { useBlocker } from '@tanstack/react-router'

import { onWindowCloseRequested } from '#/lib/desktop.ts'
import { useConfirm } from '#/lib/use-confirm.tsx'

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
  // The app-styled confirm (stable across renders). A ref anyway, so the
  // once-registered blocker / close handler always calls the live one.
  const confirm = useConfirm()
  const confirmRef = useRef(confirm)
  confirmRef.current = confirm
  // ask() reads refs (message + the live confirm), so a blocker that registered
  // once still shows the CURRENT prompt text in the app's own modal. Stable, so
  // the close-request effect registers exactly once.
  const ask = useCallback(
    () =>
      confirmRef.current(messageRef.current, { title: 'Unsaved changes', confirmLabel: 'Leave' }),
    [],
  )
  useBlocker({
    shouldBlockFn: async () => {
      if (!dirtyRef.current || bypassRef.current) return false
      const leave = await ask()
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
        const leave = await ask()
        if (!leave) event.preventDefault()
      } finally {
        asking = false
      }
    })
  }, [ask])
  return {
    bypass: () => {
      bypassRef.current = true
    },
  }
}
