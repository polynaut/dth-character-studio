import { useState } from 'react'

import { Input } from '#/components/ui/input.tsx'

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
