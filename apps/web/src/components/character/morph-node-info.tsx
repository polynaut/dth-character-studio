import { useContext } from 'react'
import { X } from 'lucide-react'

import { cn } from '@dth/ui'

import { MorphIndexContext } from '#/components/rom/contexts.ts'

/**
 * The Item-scope info row UNDER a preserve/frame-0 morph-name field: the same
 * facts the picked autocomplete suggestion showed, in the same small-label
 * styling — the node the dial lives on, the "this scene" badge for a
 * scene-scanned dial, and the Daz UI name when it differs from the internal
 * name. The node is the row's STORED scope; the other two are re-looked-up in
 * the morph index at render time (they aren't stored), so they show exactly
 * while the index still offers that entry — a hand-typed morph, or a scene
 * entry whose scene isn't selected, shows the stored node alone.
 *
 * The scope itself is READ-ONLY: picking a suggestion is its only setter (the
 * index knows which node a dial lives on; hand-typing node names invited typos
 * only Daz could catch), and the badge's ✕ clears it back to the list's
 * unscoped reach, named by `fallback` ("All items" / "Figure") — which is also
 * what an unscoped row renders as. Accepted consequence: a morph typed by hand
 * cannot be scoped — every ROM/export run re-scans its scene, so the index the
 * pick needs stays current.
 */
export function MorphNodeInfo({
  name,
  node,
  fallback,
  fallbackTitle,
  scopedTitle,
  muted,
  onClear,
}: {
  /** The row's morph name — keys the index lookup for the pick-time facts. */
  name: string
  node: string
  /** What an empty scope means for this list — shown in place of the badge. */
  fallback: string
  fallbackTitle: string
  /** Tooltip of the node badge while a node is set. */
  scopedTitle: string
  /** Inherited-row muting (non-primary scene, row not overridden). */
  muted?: boolean
  onClear: () => void
}) {
  const index = useContext(MorphIndexContext)
  const entry = node ? index.find((e) => e.name === name && e.node === node) : undefined

  if (!node) {
    return (
      <div className="mt-1 flex items-center pl-1">
        <span className="text-xs text-muted-foreground/70 italic" title={fallbackTitle}>
          {fallback}
        </span>
      </div>
    )
  }
  return (
    <div
      className={cn(
        'mt-1 flex flex-wrap items-center gap-1.5 pl-1',
        muted && 'text-muted-foreground',
      )}
    >
      {/* The node badge — the stored scope, styled like the suggestion's but a
          size up (text-xs): under the field it carries the scope on its own,
          with no suggestion row around it to read it against. */}
      <span
        className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
        title={scopedTitle}
      >
        {node}
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
      {entry?.fromScene && (
        <span className="rounded bg-primary/20 px-1.5 py-0.5 text-xs text-primary">
          this scene
        </span>
      )}
      {entry && entry.label !== entry.name && (
        <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          Daz UI name: {entry.label}
        </span>
      )}
    </div>
  )
}
