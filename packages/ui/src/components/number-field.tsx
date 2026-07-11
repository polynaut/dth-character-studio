import { useEffect, useState } from 'react'

import { Input } from '../primitives/input.tsx'

export function NumberField({
  value,
  onCommit,
  className,
}: {
  value: number
  onCommit: (value: number) => void
  className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  // Re-sync when `value` changes underneath us — e.g. removing a non-last row of
  // a KeyedListEditor (index keys) reuses this instance with a new `value` prop;
  // without this the field would keep showing (and could commit) the old number.
  useEffect(() => setDraft(String(value)), [value])
  return (
    <Input
      className={className}
      value={draft}
      inputMode="decimal"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = Number(draft)
        if (!Number.isNaN(parsed)) onCommit(parsed)
        else setDraft(String(value))
      }}
    />
  )
}
