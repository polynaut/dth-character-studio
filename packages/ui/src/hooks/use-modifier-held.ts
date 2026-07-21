import { useSyncExternalStore } from 'react'

const MOUSE_FLAG = {
  Control: 'ctrlKey',
  Shift: 'shiftKey',
  Meta: 'metaKey',
  Alt: 'altKey',
} as const

type ModifierKey = keyof typeof MOUSE_FLAG

type ModifierStore = {
  subscribe: (onChange: () => void) => () => void
  getSnapshot: () => boolean
}

/**
 * ONE shared store (and one set of window listeners) per modifier key, no
 * matter how many components consume it — pages mount a dozen+ `useModifierHeld`
 * consumers (every path chip / card), and per-instance listeners meant five
 * window listeners each, including a mousemove. The store lazily attaches its
 * listeners when the first subscriber arrives and detaches when the last one
 * leaves.
 */
const stores = new Map<ModifierKey, ModifierStore>()

function storeFor(key: ModifierKey): ModifierStore {
  const existing = stores.get(key)
  if (existing) return existing

  const flag = MOUSE_FLAG[key]
  const listeners = new Set<() => void>()
  let held = false
  let detach: (() => void) | null = null

  const set = (next: boolean) => {
    if (held === next) return
    held = next
    for (const listener of listeners) listener()
  }
  const attach = () => {
    const down = (e: KeyboardEvent) => {
      if (e.key === key) set(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === key) set(false)
    }
    // Every pointer event reports the CURRENT modifier state — a cheap sync
    // (set() bails on identical values) that self-heals missed key events.
    const sync = (e: MouseEvent) => set(e[flag])
    const clear = () => set(false)
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
  }

  const store: ModifierStore = {
    subscribe: (onChange) => {
      if (listeners.size === 0) detach = attach()
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
        if (listeners.size === 0) {
          detach?.()
          detach = null
          // Nothing is listening anymore — don't leak a stale "held" into the
          // next mount (matches the old per-instance useState(false) start).
          held = false
        }
      }
    },
    getSnapshot: () => held,
  }
  stores.set(key, store)
  return store
}

const getServerSnapshot = () => false

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
export function useModifierHeld(key: ModifierKey): boolean {
  const store = storeFor(key)
  return useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot)
}
