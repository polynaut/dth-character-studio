import { useContext, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'

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
 *
 * A proper combobox (mirroring the ui kit's MultiSelect): focus stays on the
 * input, ArrowDown/Up walk an active suggestion with wrap-around, Enter picks
 * the active one through the same onPick as a mouse pick (so keyboard users get
 * the node auto-selected too), Escape closes. With NO active suggestion (fresh
 * typing) Enter keeps its plain-cell meaning — commit the typed text. State is
 * announced via role="combobox" + aria-activedescendant; the options are
 * aria-only targets (tabIndex -1), so real focus never leaves the input and
 * blur still means "focus left the cell" — a mouse pick preventDefaults its
 * mousedown, so no blur ever unmounts the list before the pick lands.
 */
export function MorphNameCell({
  value,
  placeholder,
  onCommit,
  onPick,
  inputClassName,
  disabled = false,
}: {
  value: string
  placeholder?: string
  onCommit: (prop: string) => void
  onPick: (entry: MorphIndexEntry) => void
  /** Override the input's look — defaults to the borderless table-cell style;
   *  the preserve-morph list passes a bordered form-field class. */
  inputClassName?: string
  disabled?: boolean
}) {
  const index = useContext(MorphIndexContext)
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  // The active suggestion; -1 = none (typing stays free-form, Enter commits).
  const [active, setActive] = useState(-1)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const optionId = (i: number) => `${baseId}-option-${i}`
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
  // A deferred-query re-filter can shrink the list — clamp the pointer instead
  // of aiming past the end (Math.min keeps -1 as "none").
  const activeIndex = Math.min(active, matches.length - 1)
  const expanded = open && matches.length > 0

  useEffect(() => {
    if (expanded && activeIndex >= 0) {
      optionRefs.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [expanded, activeIndex])

  function close() {
    setOpen(false)
    setActive(-1)
  }

  function pick(entry: IndexedMorphEntry) {
    close()
    setDraft(entry.name)
    onPick(entry)
  }

  return (
    <div className="relative">
      <input
        className={inputClassName ?? `${cellInputClass} w-full`}
        role="combobox"
        aria-expanded={expanded}
        aria-controls={expanded ? listboxId : undefined}
        aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          close()
          if (draft !== value) onCommit(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            if (!open) setOpen(true)
            if (matches.length > 0) setActive((activeIndex + 1) % matches.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) setOpen(true)
            if (matches.length > 0) {
              // From "none active", ArrowUp starts at the END of the list.
              setActive(
                activeIndex < 0
                  ? matches.length - 1
                  : (activeIndex + matches.length - 1) % matches.length,
              )
            }
          } else if (e.key === 'Enter') {
            if (expanded && activeIndex >= 0) {
              e.preventDefault()
              pick(matches[activeIndex])
            } else {
              ;(e.target as HTMLInputElement).blur()
            }
          } else if (e.key === 'Escape') {
            if (expanded) {
              // Swallow it: an Escape that closed the list must not also reach
              // whatever listens above (e.g. a surrounding dialog).
              e.preventDefault()
              e.stopPropagation()
            }
            close()
          }
        }}
      />
      {expanded && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Morph suggestions"
          className="absolute top-full left-0 z-30 mt-1 max-h-72 w-[30rem] max-w-[80vw] overflow-y-auto rounded-md border bg-popover text-popover-foreground p-1 shadow-lg"
        >
          {matches.map((e, i) => {
            const hitInternal = e.nameLower.includes(q)
            return (
              <button
                type="button"
                key={`${e.node}|${e.name}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIndex}
                tabIndex={-1}
                ref={(node) => {
                  optionRefs.current[i] = node
                }}
                className={`flex w-full flex-col gap-0.5 rounded-sm px-2 py-1 text-left text-sm ${
                  i === activeIndex ? 'bg-accent text-accent-foreground' : ''
                }`}
                onMouseEnter={() => setActive(i)}
                // mousedown fires BEFORE the input's blur — a plain onClick would
                // arrive after the menu already closed (preventDefault also keeps
                // the input focused, so the blur-commit can't race the pick).
                onMouseDown={(ev) => {
                  ev.preventDefault()
                  pick(e)
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
