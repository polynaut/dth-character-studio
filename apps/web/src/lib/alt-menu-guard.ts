/**
 * Bare Alt activates the native Windows menu bar (on the key's RELEASE) — which
 * fights the app's Alt+click "show in Explorer" hotkey: priming Alt over a chip
 * or card would focus the menu as the next action. This guard preventDefaults
 * Alt's keydown AND keyup while the pointer is over a reveal target (anything
 * carrying `data-alt-reveal`), marking the key as handled so the menu never
 * arms. An Alt press anywhere else keeps the normal menu behavior.
 */
export function installAltMenuGuard(): () => void {
  const onAltKey = (e: KeyboardEvent) => {
    // `:hover` in querySelector matches the live hover chain — no tracking state.
    if (e.key === 'Alt' && document.querySelector('[data-alt-reveal]:hover')) {
      e.preventDefault()
    }
  }
  window.addEventListener('keydown', onAltKey, true)
  window.addEventListener('keyup', onAltKey, true)
  return () => {
    window.removeEventListener('keydown', onAltKey, true)
    window.removeEventListener('keyup', onAltKey, true)
  }
}
