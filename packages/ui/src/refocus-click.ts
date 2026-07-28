/**
 * Detects the pointerdown that RE-FOCUSES the app window so overlays (Modal,
 * SidePanel) can swallow it instead of treating it as a backdrop dismiss.
 *
 * The scenario: a dialog/drawer is open but the native window lost focus (the
 * user switched to Explorer, Daz, a browser…). Their next click into the app is
 * just bringing the window back to the front — if it happens to land on the
 * backdrop, closing the dialog on it throws away whatever they had in progress.
 *
 * Detection is a tiny state machine instead of a plain "focused recently"
 * timestamp, because the two must not be conflated:
 *  - window `blur` arms the guard; the FIRST pointerdown afterwards is the
 *    candidate refocus click (later clicks are real interactions).
 *  - If the window was re-focused WITHOUT a click (Alt-Tab, taskbar), a click
 *    that follows later is a deliberate one — so the candidate only counts
 *    when it lands within a short grace period of the `focus` event (or before
 *    it: WebView2's focus/pointerdown delivery order isn't guaranteed).
 *
 * Overlays call {@link isRefocusPointerDown} with the ORIGINAL pointer event
 * (Radix hands it over as `event.detail.originalEvent`) — identity comparison,
 * so a marked click inside the panel can never suppress a later real dismiss.
 */

const FOCUS_CLICK_GRACE_MS = 400

// True while the window is (or may be) unfocused — including at load, when the
// app can start without focus (e.g. opened via file association in the back).
let pendingRefocus = typeof document !== 'undefined' && !document.hasFocus()
let focusedAt: number | null = null
let refocusPointerDown: Event | null = null

if (typeof window !== 'undefined') {
  window.addEventListener('blur', () => {
    pendingRefocus = true
    focusedAt = null
  })
  window.addEventListener('focus', () => {
    if (pendingRefocus) focusedAt = Date.now()
  })
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!pendingRefocus) return
      pendingRefocus = false
      // No focus event yet = this click IS what's focusing the window.
      if (focusedAt === null || Date.now() - focusedAt < FOCUS_CLICK_GRACE_MS) {
        refocusPointerDown = e
      }
    },
    // Capture on window: guaranteed to run before Radix's document-level
    // (bubble-phase) outside-pointerdown listeners consult the guard.
    { capture: true },
  )
}

/** True when `event` is the pointerdown that re-focused the app window. */
export function isRefocusPointerDown(event: Event): boolean {
  return event === refocusPointerDown
}
