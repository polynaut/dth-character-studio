import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'

import type { ReactNode } from 'react'

import type { BoneIndexEntry } from '#/lib/rom/api.ts'

import { cellInputClass, menuActiveOptionClass, menuSurfaceClass } from './cells.tsx'

/** A bone-index entry with its search keys pre-lowercased once, so the
 *  per-keystroke filter doesn't re-lowercase on every character typed. */
export interface IndexedBoneEntry extends BoneIndexEntry {
  nameLower: string
  labelLower: string
}

/** Pre-lowercase a scanned bone list for {@link BoneNameCell}. The list is small
 *  (a figure has a couple hundred bones), so callers memoize this once and share
 *  it across the rules' cells. */
export function indexBones(bones: Array<BoneIndexEntry>): Array<IndexedBoneEntry> {
  return bones.map((b) => ({ ...b, nameLower: b.name.toLowerCase(), labelLower: b.label.toLowerCase() }))
}

/** Wrap the first case-insensitive occurrence of the query in a highlight. */
function highlightMatch(text: string, q: string): ReactNode {
  const at = q ? text.toLowerCase().indexOf(q) : -1
  if (at < 0) return text
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-primary/30 text-inherit">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  )
}

/**
 * The JCM bone-name input with autocomplete over the scanned bone index
 * (`Build_Genesis_Index.dsa` output → the `bones` array). Search hits match the
 * bone's UI label OR its internal name; picking one inserts the LABEL — what the
 * runtime resolves first (findNodeChildByLabel → findNodeChild) and what the
 * field stores by default. Free typing still works exactly like a plain cell
 * (committed on blur), so a bone that wasn't scanned (or a custom rig) can always
 * be typed by hand.
 *
 * A combobox mirroring {@link MorphNameCell}: focus stays on the input,
 * ArrowDown/Up walk an active suggestion with wrap-around, Enter picks the active
 * one, Escape closes. With NO active suggestion Enter keeps its plain-cell
 * meaning — commit the typed text.
 */
export function BoneNameCell({
  value,
  bones,
  onCommit,
  placeholder,
  title,
  inputClassName,
  disabled = false,
}: {
  value: string
  /** The pre-lowercased bone list (see {@link indexBones}). */
  bones: Array<IndexedBoneEntry>
  onCommit: (value: string) => void
  placeholder?: string
  title?: string
  inputClassName?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  // The active suggestion; -1 = none (typing stays free-form, Enter commits).
  const [active, setActive] = useState(-1)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const optionId = (i: number) => `${baseId}-option-${i}`
  useEffect(() => setDraft(value), [value])
  // Deferred so fast typing stays responsive; suggestions + highlights read the
  // same deferred value, so they always agree.
  const q = useDeferredValue(draft.trim().toLowerCase())
  const matches = useMemo<Array<IndexedBoneEntry>>(() => {
    if (!open || q.length < 1 || bones.length === 0) return []
    const out: Array<IndexedBoneEntry> = []
    for (const b of bones) {
      if (b.nameLower.includes(q) || b.labelLower.includes(q)) {
        out.push(b)
        if (out.length === 8) break
      }
    }
    return out
  }, [open, q, bones])
  // A deferred-query re-filter can shrink the list — clamp instead of aiming past
  // the end (Math.min keeps -1 as "none").
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

  function pick(entry: IndexedBoneEntry) {
    close()
    setDraft(entry.label)
    if (entry.label !== value) onCommit(entry.label)
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
        title={title}
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
                activeIndex < 0 ? matches.length - 1 : (activeIndex + matches.length - 1) % matches.length,
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
              // Swallow it: an Escape that closed the list must not also reach a
              // surrounding dialog.
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
          aria-label="Bone suggestions"
          className={`absolute top-full left-0 z-30 mt-1 max-h-72 w-[22rem] max-w-[80vw] overflow-y-auto p-1 ${menuSurfaceClass}`}
        >
          {matches.map((b, i) => (
            <button
              type="button"
              key={b.name}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              tabIndex={-1}
              ref={(node) => {
                optionRefs.current[i] = node
              }}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-sm ${
                i === activeIndex ? menuActiveOptionClass : ''
              }`}
              onMouseEnter={() => setActive(i)}
              // mousedown fires BEFORE the input's blur — a plain onClick would
              // arrive after the menu already closed (preventDefault also keeps
              // the input focused, so the blur-commit can't race the pick).
              onMouseDown={(ev) => {
                ev.preventDefault()
                pick(b)
              }}
            >
              {/* The label — what picking inserts. */}
              <span className="font-medium [overflow-wrap:anywhere]">{highlightMatch(b.label, q)}</span>
              {/* The internal name, when it differs — a muted tag, so a match on
                  the internal name still shows WHERE it hit. */}
              {b.name !== b.label && (
                <span className="ml-auto shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {highlightMatch(b.name, q)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
