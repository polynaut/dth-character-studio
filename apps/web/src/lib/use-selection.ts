import { useState } from 'react'

/**
 * Tracks a set of selected item ids for an overview's multi-select. `selecting`
 * is true whenever anything is selected — overviews use it to switch a card
 * click from "navigate" to "toggle selection" and to reveal the selection bar.
 */
export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  return {
    selected,
    count: selected.size,
    selecting: selected.size > 0,
    isSelected: (id: string) => selected.has(id),
    toggle: (id: string) =>
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }),
    selectAll: (ids: Array<string>) => setSelected(new Set(ids)),
    clear: () => setSelected(new Set()),
  }
}
