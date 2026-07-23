import { RotateCcw } from 'lucide-react'

import { cn } from '../cn.ts'

/**
 * The "follows the Daz scene" glyph — an isometric cube (drawn in `currentColor`).
 * The bottom-right dot is drawn only when `dotClassName` is given; it's shown for
 * overridden fields only, so the dot itself is the subtle "overridden" tell.
 */
function CubeDotIcon({ className, dotClassName }: { className?: string; dotClassName?: string }) {
  return (
    <svg viewBox="5 5 40 40" fill="none" aria-hidden className={className}>
      <g stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M24 8L38 16L24 24L10 16L24 8Z" />
        <path d="M10 16V34L24 42V24" />
        <path d="M38 16V34L24 42" />
      </g>
      {dotClassName ? <circle cx="36" cy="36" r="5" className={dotClassName} /> : null}
    </svg>
  )
}

// A 24px (size-6) square button chip — the same footprint as the InfoPopup "i", so the
// two inline controls line up as consistent small buttons. The 16px cube centres in it.
// `-translate-y-px` optically aligns the chip with the label text (it always sits in a
// field label); the InfoPopup "i" gets the same nudge from its label call sites.
const CHIP =
  'relative inline-flex size-6 shrink-0 -translate-y-px items-center justify-center rounded-md'

/**
 * The per-scene override marker on a Daz-scene-tied field's label.
 *
 * Always rendered as a small square button chip (matching the InfoPopup), so a field
 * going overridden never shifts and the two inline controls read consistently:
 *
 * - **Not overridden** → a quiet, non-focusable chip with a faint bg; a bare cube (NO
 *   dot) marks a field that CAN be overridden per Daz scene (its title carries the
 *   hint). Nothing to reset, so it isn't a tab stop.
 * - **Overridden** → a real, keyboard-reachable `<button>` with a persistent green chip
 *   (bg + inset ring, shown at rest too — not only on hover). The green cube — now with
 *   its bottom-right dot, the subtle overridden tell — is its resting face; hovering or
 *   focusing it swaps the cube for a white reset icon inside the same chip. Both key off
 *   this button's own `group/mark`, so a nearby control never triggers the swap.
 *
 * Usage: drop this into the Label after the text — it's self-contained (no group needed).
 */
/**
 * Text colour for a per-scene overridable field's LABEL, mirroring the ROM
 * section-title treatment:
 * - **overridden** → fully white (reads as active),
 * - **overridable but still inherited** (a non-primary scene, not yet overridden) →
 *   a muted gray, the quiet "not yet overridden" tell,
 * - **primary scene** (not overridable) → the default foreground (empty string).
 *
 * Drop it into the label's `cn(...)` alongside the {@link OverrideMark} glyph.
 */
export function overrideLabelClass(overridden: boolean, overrideEligible: boolean): string {
  return overridden ? 'text-white' : overrideEligible ? 'text-muted-foreground' : ''
}

export function OverrideMark({
  overridden,
  onReset,
  resetTitle = "Reset to the primary scene's value",
  className,
}: {
  overridden: boolean
  onReset: () => void
  /** Title/aria on the reset control. Defaults to "reset to the primary"; hair
   *  passes a "clear" variant since it has no primary value to fall back to. */
  resetTitle?: string
  className?: string
}) {
  if (!overridden) {
    return (
      <span
        title="Can be overridden per Daz scene"
        className={cn(CHIP, 'bg-white/5 text-foreground/85', className)}
      >
        <CubeDotIcon className="size-4" />
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onReset}
      title={resetTitle}
      aria-label={resetTitle}
      className={cn(
        CHIP,
        'group/mark cursor-pointer bg-daz-green/15 text-daz-green ring-1 ring-inset ring-daz-green/30 outline-none transition-colors hover:bg-daz-green/25 focus-visible:ring-2 focus-visible:ring-daz-green/60',
        className,
      )}
    >
      {/* Resting face: the green cube. Fades out on hover/keyboard focus. */}
      <CubeDotIcon
        className="size-4 transition-opacity group-hover/mark:opacity-0 group-focus/mark:opacity-0"
        dotClassName="fill-current"
      />
      {/* Revealed face: a white reset icon, inside the same persistent green chip. */}
      <span
        aria-hidden
        className="absolute inset-0 flex items-center justify-center text-white opacity-0 transition-opacity group-hover/mark:opacity-100 group-focus/mark:opacity-100"
      >
        <RotateCcw className="size-3.5" />
      </span>
    </button>
  )
}
