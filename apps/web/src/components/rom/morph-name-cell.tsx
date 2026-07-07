import { useContext, useDeferredValue, useEffect, useMemo, useState } from 'react'

import type { ReactNode } from 'react'

import type { MorphIndexEntry } from '#/lib/rom/api.ts'

import { cellInputClass } from './cells.tsx'
import { MorphIndexContext } from './contexts.ts'
import type { IndexedMorphEntry } from './contexts.ts'

/**
 * Wraps the first case-insensitive occurrence of the query in a highlight, so
 * a suggestion shows WHERE it matched (the query may hit the internal name,
 * the UI label, or both).
 */
function highlightMatch(text: string, q: string): ReactNode {
  const at = q ? text.toLowerCase().indexOf(q) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-primary/30 text-inherit">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  )
}

/**
 * The Morph-name input with autocomplete over the scanned morph index
 * (Scan_Morphs_<Genesis>.dsa output). Search hits match the internal name OR the
 * Daz UI label; each entry shows which field matched and the node the morph
 * lives on — picking one sets BOTH the internal name and the node on the morph.
 * Free typing still works exactly like a plain cell (committed on blur).
 */
export function MorphNameCell({
  value,
  placeholder,
  onCommit,
  onPick,
}: {
  value: string
  placeholder?: string
  onCommit: (prop: string) => void
  onPick: (entry: MorphIndexEntry) => void
}) {
  const index = useContext(MorphIndexContext)
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  useEffect(() => setDraft(value), [value])
  // The query is deferred so fast typing keeps the input responsive: React may
  // render the keystroke first and catch the (memoized) filter up right after.
  // The suggestions + highlights are computed from the SAME deferred value, so
  // they always agree with each other. Matching semantics are unchanged — the
  // index carries pre-lowercased keys, and the scan stops at the 8-result cap.
  const q = useDeferredValue(draft.trim().toLowerCase())
  const matches = useMemo<Array<IndexedMorphEntry>>(() => {
    if (!open || q.length < 2 || index.length === 0) return []
    const out: Array<IndexedMorphEntry> = []
    for (const e of index) {
      if (e.nameLower.includes(q) || e.labelLower.includes(q)) {
        out.push(e)
        if (out.length === 8) break
      }
    }
    return out
  }, [open, q, index])
  return (
    <div className="relative">
      <input
        className={`${cellInputClass} w-full`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false)
          if (draft !== value) onCommit(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      {matches.length > 0 && (
        <div className="absolute top-full left-0 z-30 mt-1 max-h-72 w-[30rem] max-w-[80vw] overflow-y-auto rounded-md border bg-popover text-popover-foreground p-1 shadow-lg">
          {matches.map((e) => {
            const hitInternal = e.nameLower.includes(q)
            return (
              <button
                type="button"
                key={`${e.node}|${e.name}`}
                className="flex w-full flex-col gap-0.5 rounded-sm px-2 py-1 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                // mousedown fires BEFORE the input's blur — a plain onClick would
                // arrive after the menu already closed.
                onMouseDown={(ev) => {
                  ev.preventDefault()
                  setOpen(false)
                  setDraft(e.name)
                  onPick(e)
                }}
              >
                <span className="flex w-full items-center gap-2">
                  {/* The internal name — what picking inserts. Never truncated. */}
                  <span className="font-medium [overflow-wrap:anywhere]">
                    {highlightMatch(e.name, q)}
                  </span>
                  <span className="ml-auto flex shrink-0 gap-1">
                    <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                      {hitInternal ? 'internal match' : 'UI name match'}
                    </span>
                    <span className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                      {e.node}
                    </span>
                  </span>
                </span>
                {/* The Daz UI name on its own labeled line (only when it differs)
                    and never truncated — a hit here must stay READABLE, or a
                    match on "GPL_…" looks like a wrong "GP_…" suggestion. */}
                {e.label !== e.name && (
                  <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    Daz UI name: {highlightMatch(e.label, q)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
