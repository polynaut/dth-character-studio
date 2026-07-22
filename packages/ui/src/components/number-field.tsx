import { useCallback, useEffect, useState } from 'react'

import { Input } from '../primitives/input.tsx'

export function NumberField({
  value,
  onCommit,
  className,
  suffix,
  percent,
}: {
  value: number
  onCommit: (value: number) => void
  className?: string
  /** Unit overlaid on the right inside the field (e.g. "%"). Pass enough right
   *  padding via className (pr-6) so the number doesn't run under it. */
  suffix?: string
  /** Show/edit a 0–1 value as a Daz-style percentage (0–100), like the ROM pose
   *  value cells — the field shows `value * 100` and commits back `pct / 100`.
   *  Implies a "%" suffix. */
  percent?: boolean
}) {
  // 0–1 ⇄ 0–100 for the percent mode; toFixed trims the *100 / /100 float noise.
  const format = useCallback(
    (v: number) => (percent ? String(+(v * 100).toFixed(4)) : String(v)),
    [percent],
  )
  const [draft, setDraft] = useState(() => format(value))
  // Re-sync when `value` changes underneath us — e.g. removing a non-last row of
  // a KeyedListEditor (index keys) reuses this instance with a new `value` prop;
  // without this the field would keep showing (and could commit) the old number.
  useEffect(() => setDraft(format(value)), [value, format])
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
        // `Number('')` (and whitespace) is 0, not NaN — an emptied field must
        // revert like any other non-number, not silently commit 0 (0% in
        // percent mode).
        if (draft.trim() === '') {
          setDraft(format(value))
          return
        }
        const parsed = Number(draft)
        if (Number.isNaN(parsed)) {
          setDraft(format(value))
          return
        }
        onCommit(percent ? +(parsed / 100).toFixed(6) : parsed)
      }}
    />
  )
  const shownSuffix = suffix ?? (percent ? '%' : undefined)
  if (!shownSuffix) return input
  return (
    // `group/nf` + `has-[:disabled]` so the suffix dims in lockstep with the input
    // when it's disabled (e.g. a locked preserve/identity fieldset) — the number
    // fades via disabled:opacity-50 and the "%" would otherwise stay fully lit.
    <span className="group/nf relative inline-block">
      {input}
      <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground transition-opacity group-has-[:disabled]/nf:opacity-50">
        {shownSuffix}
      </span>
    </span>
  )
}
