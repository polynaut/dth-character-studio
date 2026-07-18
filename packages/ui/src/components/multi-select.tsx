import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

import { cn } from '../cn.ts'

/**
 * A multi-select combobox: one always-rendered field showing the selected
 * values as removable pills, with an inline text input. Clicking into it opens
 * a full-width list of the remaining options (typing filters); picking one adds
 * it and keeps the list open for the next pick. Backspace on an empty input
 * removes the last pill; Escape (or an outside click) closes the list.
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
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const onOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  const selected = new Set(values)
  const remaining = options.filter((option) => !selected.has(option))
  const filtered =
    query.trim() === ''
      ? remaining
      : remaining.filter((option) => option.toLowerCase().includes(query.trim().toLowerCase()))
  const customCandidate =
    allowCustom &&
    query.trim() !== '' &&
    !selected.has(query.trim()) &&
    !remaining.some((option) => option.toLowerCase() === query.trim().toLowerCase())
      ? query.trim()
      : null
  // The rows the keyboard walks: matching options first, the add-custom row last.
  const rows = [...filtered, ...(customCandidate ? [customCandidate] : [])]
  const highlightIndex = Math.min(highlighted, Math.max(rows.length - 1, 0))

  const add = (value: string) => {
    onChange([...values, value])
    setQuery('')
    setHighlighted(0)
    inputRef.current?.focus()
  }
  const remove = (value: string) => {
    onChange(values.filter((v) => v !== value))
    inputRef.current?.focus()
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
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
          inputRef.current?.focus()
          setOpen((was) => !was)
        }}
      >
        {values.map((value) => {
          const warning = pillWarning?.(value) ?? null
          return (
            <span
              key={value}
              data-pill
              title={warning ?? undefined}
              className={cn(
                'flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-sm',
                warning !== null && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
              )}
            >
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                className="rounded p-0.5 hover:bg-accent"
                onClick={() => remove(value)}
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
          disabled={disabled}
          value={query}
          placeholder={values.length === 0 ? placeholder : undefined}
          className="h-6 min-w-24 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlighted(0)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
              setHighlighted((i) => Math.min(i + 1, rows.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setHighlighted((i) => Math.max(i - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const row = rows[highlightIndex]
              if (open && row !== undefined) add(row)
            } else if (event.key === 'Escape') {
              setOpen(false)
              setQuery('')
            } else if (event.key === 'Backspace' && query === '' && values.length > 0) {
              remove(values[values.length - 1])
            }
          }}
        />
        <span className="ml-auto pr-1.5 text-muted-foreground">
          {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      </div>
      {open && (
        <div
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-64 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
        >
          {rows.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {remaining.length === 0 && query.trim() === ''
                ? 'All items selected.'
                : 'No matching items.'}
            </p>
          )}
          {rows.map((row, index) => (
            <button
              key={row}
              type="button"
              role="option"
              aria-selected={index === highlightIndex}
              className={cn(
                'block w-full cursor-pointer px-3 py-2 text-left text-sm',
                index === highlightIndex && 'bg-accent text-accent-foreground',
              )}
              onMouseEnter={() => setHighlighted(index)}
              // mousedown, not click: the field's outside-close and the input blur
              // must not race the selection away.
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
                row
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
