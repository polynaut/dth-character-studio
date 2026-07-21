import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

import { cn } from '../cn.ts'

/**
 * A multi-select combobox: one always-rendered field showing the selected
 * values as removable pills, with an inline text input. Clicking into it opens
 * a full-width list of the remaining options (typing filters); picking one adds
 * it and keeps the list open for the next pick. Escape (or focus leaving the
 * field) closes the list.
 *
 * Keyboard: Arrow keys walk the list with wrap-around (Home/End/PageUp/PageDown
 * jump while open), Enter picks. Backspace on an empty input first highlights
 * the last pill, a second press removes it; ArrowLeft from the input's start
 * moves focus onto the pills themselves (ArrowLeft/Right to walk them,
 * Backspace/Delete to remove the focused one).
 *
 * With `allowCustom`, a query that matches no option can itself be added — for
 * lists whose options are best-effort suggestions rather than the full universe.
 */
export function MultiSelect({
  values,
  options,
  onChange,
  placeholder,
  pillWarning,
  allowCustom = false,
  disabled = false,
  className,
}: {
  /** The selected values, in selection order. */
  values: Array<string>
  /** All selectable options; already-selected ones are hidden from the list. */
  options: Array<string>
  onChange: (values: Array<string>) => void
  /** Shown in the inline input while nothing is typed. */
  placeholder?: string
  /** Warning tooltip for a pill (e.g. "not in the scene"), or null for none. */
  pillWarning?: (value: string) => string | null
  /** Offer adding the typed query itself when it matches no option. */
  allowCustom?: boolean
  disabled?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  // Backspace on an empty input arms (highlights) the last pill before a second
  // press actually removes it, so a stray keystroke can't silently drop a value.
  const [armed, setArmed] = useState(false)
  // Roving tab stop among the pill remove buttons (reached via ArrowLeft).
  const [focusedPill, setFocusedPill] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const pillRefs = useRef<Array<HTMLButtonElement | null>>([])
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const optionId = (index: number) => `${baseId}-option-${index}`

  const trimmed = query.trim()
  const selected = new Set(values)
  const remaining = options.filter((option) => !selected.has(option))
  const filtered =
    trimmed === ''
      ? remaining
      : remaining.filter((option) => option.toLowerCase().includes(trimmed.toLowerCase()))
  // Case-insensitive against BOTH the remaining options and the already
  // selected values — 'foo' next to a selected 'Foo' is a duplicate, not a
  // new custom entry.
  const customCandidate =
    allowCustom &&
    trimmed !== '' &&
    !values.some((value) => value.toLowerCase() === trimmed.toLowerCase()) &&
    !remaining.some((option) => option.toLowerCase() === trimmed.toLowerCase())
      ? trimmed
      : null
  // The rows the keyboard walks: matching options first, the add-custom row last.
  const rows = [...filtered, ...(customCandidate ? [customCandidate] : [])]
  const highlightIndex = Math.min(highlighted, Math.max(rows.length - 1, 0))

  useEffect(() => {
    if (open) optionRefs.current[highlightIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [open, highlightIndex])

  const close = useCallback(() => {
    setOpen(false)
    setQuery('')
    setArmed(false)
  }, [])

  // An Escape that closes the list must NOT also close a surrounding dialog.
  // React-level stopPropagation can't guarantee that: Radix overlays (our
  // Modal/SidePanel) dismiss from a document-level CAPTURE keydown listener,
  // which fires before React's root-delegated handlers ever see the event. So
  // while the list is open, swallow Escape one level higher still — a WINDOW
  // capture listener, which the capture phase visits before document, beating
  // Radix regardless of registration order.
  useEffect(() => {
    if (!open) return
    const swallowEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
    window.addEventListener('keydown', swallowEscape, { capture: true })
    return () => window.removeEventListener('keydown', swallowEscape, { capture: true })
  }, [open, close])
  const add = (value: string) => {
    onChange([...values, value])
    // With no query the list only loses the picked row, so keeping the index
    // lands on the next item; a filtered list changes wholesale — restart at 0.
    setHighlighted(trimmed === '' ? highlightIndex : 0)
    setQuery('')
    setArmed(false)
    inputRef.current?.focus()
  }
  const remove = (value: string) => {
    onChange(values.filter((v) => v !== value))
    setArmed(false)
    inputRef.current?.focus()
  }
  const focusPill = (index: number) => {
    setFocusedPill(index)
    pillRefs.current[index]?.focus()
  }
  /** Remove the pill at `index` from its own keyboard, keeping focus sensible. */
  const removeFromPill = (index: number) => {
    const next = values.filter((_, i) => i !== index)
    onChange(next)
    if (next.length === 0) {
      setFocusedPill(-1)
      inputRef.current?.focus()
      return
    }
    // Focus a SURVIVING node now (the removed one unmounts on re-render):
    // the previous pill, or — when the first was removed — the old second.
    pillRefs.current[index > 0 ? index - 1 : 1]?.focus()
    setFocusedPill(Math.max(index - 1, 0))
  }

  return (
    <div
      ref={rootRef}
      className={cn('relative', className)}
      onBlur={(event) => {
        if (rootRef.current?.contains(event.relatedTarget)) return
        close()
        setFocusedPill(-1)
      }}
    >
      <div
        className={cn(
          'flex min-h-9 w-full cursor-text flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1 text-base shadow-xs transition-[color,box-shadow] md:text-sm dark:bg-input/30',
          'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
          disabled && 'pointer-events-none opacity-50',
        )}
        onMouseDown={(event) => {
          // Clicking anywhere in the field focuses the input and toggles like a
          // select trigger — except on the pills' own controls.
          if (event.target instanceof Element && event.target.closest('[data-pill]')) return
          event.preventDefault()
          setHighlighted(0)
          // A click on an unfocused field only focuses — onFocus already opens;
          // toggling here too would immediately flip the list closed again.
          if (document.activeElement === inputRef.current) setOpen((was) => !was)
          else inputRef.current?.focus()
        }}
      >
        {values.map((value, index) => {
          const warning = pillWarning?.(value) ?? null
          const isArmed = armed && index === values.length - 1
          return (
            <span
              key={value}
              data-pill
              title={warning ?? undefined}
              className={cn(
                'flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-sm',
                warning !== null && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                isArmed && 'ring-2 ring-ring',
              )}
            >
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                disabled={disabled}
                tabIndex={index === focusedPill ? 0 : -1}
                ref={(node) => {
                  pillRefs.current[index] = node
                }}
                className="rounded p-0.5 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                // Keep the click from stealing focus (and blurring the field).
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => remove(value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' && index > 0) {
                    event.preventDefault()
                    focusPill(index - 1)
                  } else if (event.key === 'ArrowRight') {
                    event.preventDefault()
                    if (index === values.length - 1) {
                      setFocusedPill(-1)
                      inputRef.current?.focus()
                    } else {
                      focusPill(index + 1)
                    }
                  } else if (event.key === 'Backspace' || event.key === 'Delete') {
                    event.preventDefault()
                    removeFromPill(index)
                  }
                }}
              >
                <X className="size-3.5" />
              </button>
            </span>
          )
        })}
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && rows.length > 0 ? optionId(highlightIndex) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder={values.length === 0 ? placeholder : undefined}
          className="h-6 min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlighted(0)
            setArmed(false)
            setOpen(true)
          }}
          onFocus={() => {
            setFocusedPill(-1)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            const atStart =
              event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0
            if (values.length > 0 && atStart) {
              if (event.key === 'ArrowLeft') {
                event.preventDefault()
                focusPill(values.length - 1)
                return
              }
              if (event.key === 'Backspace') {
                event.preventDefault()
                if (armed) remove(values[values.length - 1])
                else setArmed(true)
                return
              }
            }
            setArmed(false)
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              if (open) setHighlighted(rows.length > 0 ? (highlightIndex + 1) % rows.length : 0)
              else {
                setOpen(true)
                setHighlighted(0)
              }
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              if (open) {
                setHighlighted(rows.length > 0 ? (highlightIndex + rows.length - 1) % rows.length : 0)
              } else {
                setOpen(true)
                setHighlighted(Math.max(rows.length - 1, 0))
              }
            } else if (event.key === 'Home' && open) {
              event.preventDefault()
              setHighlighted(0)
            } else if (event.key === 'End' && open) {
              event.preventDefault()
              setHighlighted(Math.max(rows.length - 1, 0))
            } else if (event.key === 'PageDown' && open) {
              event.preventDefault()
              setHighlighted(Math.min(highlightIndex + 10, Math.max(rows.length - 1, 0)))
            } else if (event.key === 'PageUp' && open) {
              event.preventDefault()
              setHighlighted(Math.max(highlightIndex - 10, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (!open) {
                setOpen(true)
                setHighlighted(0)
              } else if (rows[highlightIndex] !== undefined) {
                add(rows[highlightIndex])
              }
            }
            // Escape-while-open is handled by the window capture listener above
            // (it never reaches this handler); Escape-while-closed propagates
            // normally so a surrounding dialog can close.
          }}
        />
        <span aria-hidden className="ml-auto pr-1.5 text-muted-foreground">
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      </div>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {rows.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {remaining.length === 0 && trimmed === ''
                ? 'All items selected.'
                : 'No matching items.'}
            </p>
          )}
          {rows.map((row, index) => (
            <button
              key={row}
              id={optionId(index)}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === highlightIndex}
              ref={(node) => {
                optionRefs.current[index] = node
              }}
              className={cn(
                'block w-full cursor-pointer px-3 py-2 text-left text-sm',
                index === highlightIndex && 'bg-accent text-accent-foreground',
              )}
              onMouseEnter={() => setHighlighted(index)}
              // mousedown, not click: the field's blur-close must not race the
              // selection away.
              onMouseDown={(event) => {
                event.preventDefault()
                add(row)
              }}
            >
              {customCandidate !== null && index === rows.length - 1 ? (
                <>
                  Add “<strong>{row}</strong>”
                </>
              ) : (
                <MatchedOption option={row} query={trimmed} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** The option label with the matched part of the query set in bold. */
function MatchedOption({ option, query }: { option: string; query: string }) {
  const at = query === '' ? -1 : option.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return option
  return (
    <>
      {option.slice(0, at)}
      <strong className="font-semibold">{option.slice(at, at + query.length)}</strong>
      {option.slice(at + query.length)}
    </>
  )
}
