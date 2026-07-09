import { useEffect, useState } from 'react'

const MOUSE_FLAG = {
  Control: 'ctrlKey',
  Shift: 'shiftKey',
  Meta: 'metaKey',
  Alt: 'altKey',
} as const

/**
 * Whether a modifier key is currently held. Drives the "a modifier changes what
 * this control does" hints: path chips and cards swap their icons to an
 * open-folder icon while Alt is down, the Unreal install button wakes up on Ctrl.
 *
 * Tracked from BOTH sources on purpose:
 *  - keydown/keyup for instant reaction while the webview has focus, and
 *  - mouse events, which always carry the live modifier bits — keyboard events
 *    are unreliable for Alt on Windows (the native menu bar can swallow them,
 *    and a press while the window is unfocused never arrives), so the state
 *    re-syncs the moment the pointer moves. Window blur resets, so nothing can
 *    stick after Alt+Tab.
 */
export function useModifierHeld(key: 'Control' | 'Shift' | 'Meta' | 'Alt'): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const flag = MOUSE_FLAG[key]
    const down = (e: KeyboardEvent) => {
      if (e.key === key) setHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === key) setHeld(false)
    }
    // Every pointer event reports the CURRENT modifier state — a cheap sync
    // (React bails on identical values) that self-heals missed key events.
    const sync = (e: MouseEvent) => setHeld(e[flag])
    const clear = () => setHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousemove', sync)
    window.addEventListener('mouseover', sync)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousemove', sync)
      window.removeEventListener('mouseover', sync)
      window.removeEventListener('blur', clear)
    }
  }, [key])
  return held
}
