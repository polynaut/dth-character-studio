import { useEffect, useState } from 'react'

/**
 * Whether a modifier key is currently held, tracked window-wide (blur resets,
 * so the state can't stick after Alt+Tab). Drives the "a modifier changes what
 * this control does" hints: path chips swap their copy icon to an open-folder
 * icon while Shift is down, the Unreal install button wakes up on Ctrl.
 */
export function useModifierHeld(key: 'Control' | 'Shift' | 'Meta'): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === key) setHeld(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === key) setHeld(false)
    }
    const clear = () => setHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [key])
  return held
}
