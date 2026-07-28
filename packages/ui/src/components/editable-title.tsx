import { useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'

import { useUiConfig } from '../config.tsx'

/**
 * A page title that becomes an inline input on click (pencil appears on hover).
 * Pressing Enter or blurring commits via `onSave` and returns to the title;
 * Escape, or an empty/unchanged value, cancels. `onEditingChange` lets the page
 * suppress navigation while editing (e.g. so a back-link's first click only
 * closes the edit). A rejected `onSave` rolls the value back and surfaces the
 * error through the host's `UiConfig.onError` (the app wires it to its toast).
 */
export function EditableTitle({
  name,
  onSave,
  onEditingChange,
  ariaLabel = 'Name',
  as: As = 'h1',
  textClass = 'text-3xl font-bold',
}: {
  name: string
  onSave: (value: string) => Promise<void> | void
  onEditingChange?: (editing: boolean) => void
  ariaLabel?: string
  /** Heading element for the display state — 'div' for non-heading contexts
   *  (e.g. a card title). */
  as?: 'h1' | 'div'
  /** Font classes shared by the display text AND the edit input, so swapping
   *  states never shifts layout (default = the page-title look). */
  textClass?: string
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const { onError } = useUiConfig()

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
      onError(e instanceof Error ? e.message : String(e))
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
        // The input sizes itself to the text (field-sizing) so a long name isn't
        // cropped at the start the moment the caret lands at its end, with pr-10
        // slack for what border-box carves out of the auto width. The cap is
        // viewport-based, NOT max-w-full: the character header wraps the title
        // in a box that measures narrower than the name (the static h1 extends
        // freely past it — only a %-capped input clipped, ~30px on real names).
        // Floored so an emptied field stays grabbable. Engines without
        // field-sizing keep the old fixed width.
        className={`-mx-2 w-[26rem] max-w-full rounded-md bg-background px-2 py-0 ${textClass} ring-1 ring-border outline-none supports-[field-sizing:content]:w-auto supports-[field-sizing:content]:min-w-48 supports-[field-sizing:content]:max-w-[min(80vw,64rem)] supports-[field-sizing:content]:pr-10 supports-[field-sizing:content]:[field-sizing:content] focus:ring-primary`}
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
      <As className={textClass}>
        <button
          type="button"
          title="Rename"
          aria-label={`Rename — ${name}`}
          onClick={startEdit}
          className="cursor-pointer text-left [font:inherit]"
        >
          {name}
        </button>
      </As>
      <span
        aria-hidden
        // Solid #333 + white/20 edge at size-5 — the app's shared adornment
        // recipe (the path chips' copy hint and pencil hover match).
        className="pointer-events-none absolute -top-2 -right-2 hidden size-5 items-center justify-center rounded border border-white/20 bg-[#333] shadow-sm group-hover/title:flex"
      >
        <Pencil className="size-3 text-muted-foreground" />
      </span>
    </span>
  )
}
