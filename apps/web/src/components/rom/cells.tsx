import { useEffect, useState } from 'react'

// No width here — Tailwind resolves conflicting width utilities by stylesheet
// order, so a base w-full would silently override per-cell widths like w-20.
export const cellInputClass =
  'rounded-sm border border-transparent bg-transparent px-2 py-1 text-sm outline-none hover:border-input focus:border-ring focus:bg-background'

export const headerSelectClass =
  'rounded-md border border-input bg-transparent px-2 py-1 text-sm outline-none focus:border-ring'

// The autocomplete listbox surface (morph/bone name cells). The theme's
// --popover is barely lighter than the app background, and these menus open
// right on top of same-colored table rows — so the surface is raised well above
// the popover token (a white mix), with a light edge + deep shadow, or the open
// menu is genuinely hard to spot. Layout (positioning, width) stays per cell.
export const menuSurfaceClass =
  'rounded-md border border-white/10 bg-[color-mix(in_oklab,var(--color-popover)_88%,white)] text-popover-foreground shadow-xl shadow-black/40'

// The active (keyboard/hover) option row on that raised surface — the theme's
// --accent is DARKER than the surface, so the usual bg-accent highlight would
// read inverted here; a white overlay lifts instead.
export const menuActiveOptionClass = 'bg-white/10 text-accent-foreground'

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
          // `Number('')` (and whitespace) is 0, not NaN — a cleared cell must
          // revert like any other non-number, not silently commit 0 (the same
          // guard as the kit's NumberField).
          if (draft.trim() === '') {
            setDraft(valueToPct(value))
            return
          }
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

