import { useEffect, useState } from 'react'

/**
 * `useState` whose value is persisted to `localStorage` under `key`, so a UI
 * preference (e.g. an overview's view mode or sort order) survives reloads and
 * navigation. Reads lazily on first render and writes on every change. A
 * malformed / unavailable store falls back to `initial` without throwing.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw != null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // a full / unavailable store just means the preference won't persist
    }
  }, [key, value])
  return [value, setValue]
}
