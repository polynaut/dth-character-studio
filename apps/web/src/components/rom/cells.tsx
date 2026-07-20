import { useEffect, useState } from 'react'

// No width here — Tailwind resolves conflicting width utilities by stylesheet
// order, so a base w-full would silently override per-cell widths like w-20.
export const cellInputClass =
  'rounded-sm border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-input focus:border-ring focus:bg-background'

export const headerSelectClass =
  'rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus:border-ring'

export function TextCell({
  value,
  onCommit,
  placeholder,
  dataId,
  validate,
}: {
  value: string
  onCommit: (value: string) => void
  placeholder?: string
  /** Optional `data-pose-input` marker so a freshly inserted row can be focused. */
  dataId?: string
  /** Live validation: return an error message ('' = valid). The value is NEVER
   *  rewritten — an invalid entry stays as typed and is flagged instead. */
  validate?: (value: string) => string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const error = validate?.(draft) ?? ''
  return (
    <input
      className={`${cellInputClass} w-full ${
        error
          ? 'border-destructive bg-destructive/10 ring-2 ring-destructive/60 focus:border-destructive'
          : ''
      }`}
      value={draft}
      placeholder={placeholder}
      data-pose-input={dataId}
      aria-invalid={error ? true : undefined}
      title={error || undefined}
      // Route the validation message through the alert-styled tooltip (red).
      data-tooltip-variant={error ? 'error' : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

// Morph values are stored 0–1 but shown/edited as Daz-style percentages
// (0–100%); toFixed trims the float noise of the *100 / /100 conversions.
export function valueToPct(v: number): string {
  return String(+(v * 100).toFixed(4))
}
export function pctToValue(pct: number): number {
  return +(pct / 100).toFixed(6)
}

/** A "%" suffix overlaid on the right of a cell input. */
function PercentSuffix() {
  return (
    <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-xs text-muted-foreground">
      %
    </span>
  )
}

export function NumberCell({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(() => valueToPct(value))
  useEffect(() => setDraft(valueToPct(value)), [value])
  return (
    <div className="relative inline-block w-20">
      <input
        className={`${cellInputClass} w-full pr-5 text-right tabular-nums`}
        value={draft}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const parsed = Number(draft)
          const next = pctToValue(parsed)
          if (!Number.isNaN(parsed) && next !== value) onCommit(next)
          else setDraft(valueToPct(value))
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <PercentSuffix />
    </div>
  )
}

/** Number input that may be empty (= unset). */
export function OptionalNumberCell({
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  value: number | undefined
  placeholder: string
  disabled?: boolean
  onCommit: (value: number | undefined) => void
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : valueToPct(value))
  useEffect(() => setDraft(value === undefined ? '' : valueToPct(value)), [value])
  return (
    <div className="relative inline-block w-16">
      <input
        className={`${cellInputClass} w-full pr-5 text-right tabular-nums disabled:opacity-40`}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() === '') {
            if (value !== undefined) onCommit(undefined)
            return
          }
          const parsed = Number(draft)
          const next = pctToValue(parsed)
          if (!Number.isNaN(parsed) && next !== value) onCommit(next)
          else setDraft(value === undefined ? '' : valueToPct(value))
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <PercentSuffix />
    </div>
  )
}
