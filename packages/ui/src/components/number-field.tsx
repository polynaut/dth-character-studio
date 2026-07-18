import { useEffect, useState } from 'react'

import { Input } from '../primitives/input.tsx'

export function NumberField({
  value,
  onCommit,
  className,
  suffix,
}: {
  value: number
  onCommit: (value: number) => void
  className?: string
  /** Unit overlaid on the right inside the field (e.g. "%"). Pass enough right
   *  padding via className (pr-6) so the number doesn't run under it. */
  suffix?: string
}) {
  const [draft, setDraft] = useState(String(value))
  // Re-sync when `value` changes underneath us — e.g. removing a non-last row of
  // a KeyedListEditor (index keys) reuses this instance with a new `value` prop;
  // without this the field would keep showing (and could commit) the old number.
  useEffect(() => setDraft(String(value)), [value])
  const input = (
    <Input
      className={className}
      value={draft}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        // Enter commits like blur (EditableTitle does the same) — otherwise a
        // typed value followed by Enter (e.g. inside a dialog) stayed stale.
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      onBlur={() => {
        const parsed = Number(draft)
        if (!Number.isNaN(parsed)) onCommit(parsed)
        else setDraft(String(value))
      }}
    />
  )
  if (!suffix) return input
  return (
    <span className="relative inline-block">
      {input}
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
        {suffix}
      </span>
    </span>
  )
}
