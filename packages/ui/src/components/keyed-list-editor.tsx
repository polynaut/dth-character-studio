import { Plus, Trash2 } from 'lucide-react'
import { useRef } from 'react'
import type { ReactNode } from 'react'

import { Button } from '../primitives/button.tsx'

/**
 * An editable list of homogeneous rows — the "N of these, add/remove freely"
 * pattern (frame-0 morphs, preserve-node-transforms, …). Owns the list plumbing
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
  emptyHint,
  children,
}: {
  items: Array<T>
  onChange: (items: Array<T>) => void
  /** Factory for a fresh row when "add" is clicked. */
  newItem: () => T
  addLabel: ReactNode
  removeLabel?: string
  rowClassName?: string
  /** Dashed placeholder box shown in place of the rows when the list is empty. */
  emptyHint?: ReactNode
  children: (item: T, set: (next: T) => void, index: number) => ReactNode
}) {
  // Stable row identity. Index keys handed a deleted middle row's key — and
  // with it any transient DOM/focus state — to the row after it. Each item
  // INSTANCE gets a uid (WeakMap, so removed items just fall away); set()
  // transfers the uid to the replacement so an edit keeps its key instead of
  // remounting the row mid-typing. Rows are objects in practice; a primitive
  // item (no WeakMap identity) falls back to the old index key.
  const uids = useRef(new WeakMap<object, number>())
  const nextUid = useRef(0)
  const keyOf = (item: T, index: number): number | string => {
    if (typeof item !== 'object' || item === null) return `i${index}`
    let uid = uids.current.get(item)
    if (uid === undefined) {
      uid = nextUid.current++
      uids.current.set(item, uid)
    }
    return uid
  }
  const setAt = (index: number, next: T) => {
    const prev = items[index]
    if (
      typeof prev === 'object' &&
      prev !== null &&
      typeof next === 'object' &&
      next !== null &&
      uids.current.has(prev)
    ) {
      uids.current.set(next, uids.current.get(prev)!)
    }
    onChange(items.map((item, i) => (i === index ? next : item)))
  }
  const removeAt = (index: number) => onChange(items.filter((_, i) => i !== index))

  return (
    <>
      {items.length === 0 && emptyHint ? (
        // A dashed placeholder box (like the ROM sections' "No groups yet"). It lives in
        // the field column, so it's the width of the input rows, not the whole panel.
        <p className="mb-2 rounded-lg border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">
          {emptyHint}
        </p>
      ) : (
        // keyOf memoizes per item INSTANCE in a WeakMap ref — an idempotent
        // identity cache (re-running a discarded render re-reads the same uid),
        // which is the lazy-init exception, not a render-order bug.
        // oxlint-disable-next-line react/refs
        items.map((item, index) => (
          <div key={keyOf(item, index)} className={rowClassName}>
            {children(item, (next) => setAt(index, next), index)}
            {/* A light-red-bordered destructive icon button (like the Export-directory
                Clear), size-9 to line up with the h-9 row inputs — not a bare glyph. */}
            <Button
              variant="outline-destructive"
              size="icon"
              className="shrink-0"
              aria-label={removeLabel}
              onClick={() => removeAt(index)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))
      )}
      <Button variant="outline" size="sm" onClick={() => onChange([...items, newItem()])}>
        <Plus /> {addLabel}
      </Button>
    </>
  )
}
