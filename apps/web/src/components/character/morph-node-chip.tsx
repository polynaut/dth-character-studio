import { X } from 'lucide-react'

import { cn } from '@dth/ui'

/**
 * The read-only Item scope on a preserve/frame-0 morph row: the scene node the
 * morph is applied on / looked up on. It is set ONLY by picking an autocomplete
 * suggestion — the index knows which node a dial lives on, and hand-typing node
 * names invited typos against names only Daz can check — so the row shows a
 * chip, not an input (pill + ✕ styled after the ui kit's MultiSelect). The ✕
 * clears the scope back to the list's unscoped reach, named by `fallback`
 * ("All items" / "Figure"), which is also what an empty scope renders as.
 * Consequence, accepted: a morph typed by hand (not picked) cannot be scoped —
 * every ROM/export run re-scans its scene, so the index the pick needs stays
 * current through the app's core flow.
 */
export function MorphNodeChip({
  node,
  fallback,
  fallbackTitle,
  scopedTitle,
  muted,
  onClear,
}: {
  node: string
  /** What an empty scope means for this list — shown in place of the chip. */
  fallback: string
  fallbackTitle: string
  /** Tooltip of the chip while a node is set. */
  scopedTitle: string
  /** Inherited-row muting (non-primary scene, row not overridden). */
  muted?: boolean
  onClear: () => void
}) {
  if (!node) {
    return (
      <span
        className="flex h-9 shrink-0 items-center px-2 text-sm text-muted-foreground/70 italic"
        title={fallbackTitle}
      >
        {fallback}
      </span>
    )
  }
  return (
    <span
      className={cn(
        'flex h-9 max-w-40 shrink-0 items-center gap-1 rounded-md bg-muted px-2 text-sm',
        muted && 'text-muted-foreground',
      )}
      title={scopedTitle}
    >
      <span className="truncate">{node}</span>
      <button
        type="button"
        aria-label="Clear the item scope"
        title={fallbackTitle}
        className="rounded p-0.5 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
        onClick={onClear}
      >
        <X className="size-3.5" />
      </button>
    </span>
  )
}
