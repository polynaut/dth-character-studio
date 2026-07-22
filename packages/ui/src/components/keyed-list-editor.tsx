import { Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '../primitives/button.tsx'

/**
 * An editable list of homogeneous rows — the "N of these, add/remove freely"
 * pattern (preserve-morphs, preserve-node-transforms, …). Owns the list plumbing
 * (immutable set-at / remove-at, the per-row delete button, the add button) so a
 * caller only describes ONE row via `children`, instead of re-writing the
 * `.map(...mi === i ? {...} : m)` / `.filter(...)` boilerplate per field.
 *
 * @param children render one row: receive the item, a `set(next)` that replaces
 *   it immutably, and the row index; return the field controls (no delete button
 *   — this component supplies it).
 */
export function KeyedListEditor<T>({
  items,
  onChange,
  newItem,
  addLabel,
  removeLabel = 'Remove',
  rowClassName = 'mb-2 flex items-center gap-2',
  children,
}: {
  items: Array<T>
  onChange: (items: Array<T>) => void
  /** Factory for a fresh row when "add" is clicked. */
  newItem: () => T
  addLabel: ReactNode
  removeLabel?: string
  rowClassName?: string
  children: (item: T, set: (next: T) => void, index: number) => ReactNode
}) {
  const setAt = (index: number, next: T) =>
    onChange(items.map((item, i) => (i === index ? next : item)))
  const removeAt = (index: number) => onChange(items.filter((_, i) => i !== index))

  return (
    <>
      {items.map((item, index) => (
        <div key={index} className={rowClassName}>
          {children(item, (next) => setAt(index, next), index)}
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 border border-input"
            aria-label={removeLabel}
            onClick={() => removeAt(index)}
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...items, newItem()])}>
        <Plus /> {addLabel}
      </Button>
    </>
  )
}
