import type { ReactNode } from 'react'

/**
 * A scene wearable's coarse kind, guessed from its label. The scene `.duf` only
 * gives us the label (no real asset-type field — that lives in the referenced
 * library `.dsf`, which we don't read across the network), so this is a best-
 * effort heuristic in the same spirit as the codebase's existing hair-detection
 * regex. Its job is to help the eye tell hair from the outfit items it's mixed
 * in with when picking a scene's hair — not to be authoritative.
 */
export type GroomKind = 'hair' | 'clothing' | 'graft'

/** Hair-ish labels — also floats these to the top of the groom suggestions. */
export const HAIRISH = /hair|brow|lash|beard|wig|cap\b|pony|braid|bang|bun\b|fur/i
/** Body followers + gen assets are never groom candidates. */
export const BODY_FOLLOWER = /^genesis ?9|goldenpalace|dicktator/i
/** Geografts (genitalia / anatomy grafts) — clothing-like conforms, but not hair. */
const GRAFTISH = /graft|geo-?graft|golden ?palace|dicktator|genital|futalicious/i

/** Best-effort classify a wearable label as hair, a geograft, or (default) clothing. */
export function groomKind(label: string): GroomKind {
  if (GRAFTISH.test(label)) return 'graft'
  if (HAIRISH.test(label)) return 'hair'
  return 'clothing'
}

/** Each kind gets its own pastel hue, shared by the result-row badge and the
 *  selected pill's fill so the two read as the same colour. Soft `-200` tints in
 *  light mode; translucent in dark so they sit gently on the surface. */
const KIND_META: Record<GroomKind, { label: string; badge: string; pill: string }> = {
  hair: {
    label: 'Hair',
    badge: 'bg-violet-200 text-violet-900 dark:bg-violet-400/25 dark:text-violet-50',
    pill: 'bg-violet-200 text-violet-900 dark:bg-violet-400/20 dark:text-violet-50',
  },
  clothing: {
    label: 'Clothing',
    badge: 'bg-sky-200 text-sky-900 dark:bg-sky-400/25 dark:text-sky-50',
    pill: 'bg-sky-200 text-sky-900 dark:bg-sky-400/20 dark:text-sky-50',
  },
  graft: {
    label: 'Graft',
    badge: 'bg-amber-200 text-amber-900 dark:bg-amber-400/25 dark:text-amber-50',
    pill: 'bg-amber-200 text-amber-900 dark:bg-amber-400/20 dark:text-amber-50',
  },
}

/** The pastel fill classes for a groom item's selected pill (by its kind). */
export function groomPillClass(label: string): string {
  return KIND_META[groomKind(label)].pill
}

/** A small pastel type badge for a groom result row (hair / clothing / graft). */
export function GroomKindTag({ kind }: { kind: GroomKind }): ReactNode {
  const { label, badge } = KIND_META[kind]
  return (
    <span
      title={`Guessed type: ${label}`}
      className={`inline-block shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge}`}
    >
      {label}
    </span>
  )
}

/** The type badge for a groom item's label — a stable `MultiSelect.optionBadge`
 *  callback (module-scoped so it isn't re-created on every render). */
export function groomBadge(label: string): ReactNode {
  return <GroomKindTag kind={groomKind(label)} />
}
