import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { toast } from 'sonner'

/**
 * A page title that becomes an inline input on click (pencil appears on hover).
 * Pressing Enter or blurring commits via `onSave` and returns to the title;
 * Escape, or an empty/unchanged value, cancels. `onEditingChange` lets the page
 * suppress navigation while editing (e.g. so a back-link's first click only
 * closes the edit).
 */
export function EditableTitle({
  name,
  onSave,
  onEditingChange,
  ariaLabel = 'Name',
}: {
  name: string
  onSave: (value: string) => Promise<void> | void
  onEditingChange?: (editing: boolean) => void
  ariaLabel?: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    onEditingChange?.(editing)
  }, [editing, onEditingChange])

  async function commit() {
    if (busy) return
    const next = value.trim()
    if (!next || next === name) {
      setValue(name)
      setEditing(false)
      return
    }
    setBusy(true)
    try {
      await onSave(next)
    } catch (e) {
      setValue(name)
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setEditing(false)
    }
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        disabled={busy}
        aria-label={ariaLabel}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setValue(name)
            setEditing(false)
          }
        }}
        onBlur={() => void commit()}
        // The field outline is a ring (box-shadow), not a border, so it adds no
        // layout height; with py-0 the input box equals the <h1> line box exactly
        // and editing shifts nothing. -mx-2 offsets the h-padding to keep the
        // text in the same place.
        className="-mx-2 w-[26rem] max-w-full rounded-md bg-background px-2 py-0 text-3xl font-bold ring-1 ring-border outline-none focus:ring-primary"
      />
    )
  }

  function startEdit() {
    setValue(name)
    setEditing(true)
  }

  return (
    <span className="group/title relative inline-flex max-w-full">
      {/* A real button INSIDE the heading: role="button" on the <h1> itself
          erased the page's main heading from the accessibility tree (no
          heading-nav landmark). The button inherits the h1's font. */}
      <h1 className="text-3xl font-bold">
        <button
          type="button"
          title="Rename"
          aria-label={`Rename — ${name}`}
          onClick={startEdit}
          className="cursor-pointer text-left [font:inherit]"
        >
          {name}
        </button>
      </h1>
      <span
        aria-hidden
        className="pointer-events-none absolute -top-2 -right-2 hidden items-center justify-center rounded border bg-card p-1 shadow-sm group-hover/title:flex"
      >
        <Pencil className="size-3 text-muted-foreground" />
      </span>
    </span>
  )
}
