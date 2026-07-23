import { RotateCcw } from 'lucide-react'

import { cn } from '../cn.ts'

/**
 * The "follows the Daz scene" glyph — an isometric cube (drawn in `currentColor`)
 * with a separately-coloured dot, so the dot can go white → green independently of
 * the cube. Tightened viewBox so the small (16px) render fills the box.
 */
function CubeDotIcon({ className, dotClassName }: { className?: string; dotClassName?: string }) {
  return (
    <svg viewBox="5 5 40 40" fill="none" aria-hidden className={className}>
      <g stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M24 8L38 16L24 24L10 16L24 8Z" />
        <path d="M10 16V34L24 42V24" />
        <path d="M38 16V34L24 42" />
      </g>
      <circle cx="36" cy="36" r="5" className={dotClassName} />
    </svg>
  )
}

// Layout footprint shared by both states, so a field going overridden never shifts:
// a 16px inline box, `-my-px` so it doesn't grow the ~14px label row.
const BOX = '-my-px inline-flex size-4 shrink-0 items-center justify-center'

/**
 * The per-scene override marker on a Daz-scene-tied field's label.
 *
 * The cube glyph is ALWAYS shown (so it also marks the field on the primary scene).
 * Its dot is white while the field matches the primary scene and turns Daz-green once
 * the field is overridden.
 *
 * - **Not overridden** → a plain, non-focusable hint span; the "can be overridden per
 *   Daz scene" title lives here. Nothing to reset, so it isn't a tab stop.
 * - **Overridden** → the mark IS a real `<button>` (the cube is its resting face, not a
 *   separate invisible overlay), so it's properly keyboard-reachable. Hovering it OR
 *   focusing it via the keyboard swaps the cube for a small green "reset" chip button.
 *   Both the fade-out and the reveal key off this button's own `group/mark` state, so a
 *   nearby control (e.g. a toggle in the same row) never triggers the swap. The reset
 *   chip is `-inset-1` (a comfortable target past the 16px glyph) but absolutely
 *   positioned, so the label footprint stays fixed.
 *
 * Usage: drop this into the Label after the text — it's self-contained (no group needed).
 */
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
    // Decorative hint — the cube marks a field that CAN be overridden per Daz scene.
    return (
      <span
        title="Can be overridden per Daz scene"
        className={cn(BOX, 'text-foreground/85', className)}
      >
        <CubeDotIcon className="size-4" dotClassName="fill-current" />
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onReset}
      title={resetTitle}
      aria-label={resetTitle}
      className={cn('group/mark relative cursor-pointer rounded-md text-daz-green outline-none', BOX, className)}
    >
      {/* Resting face: the green cube (its dot bobs). Fades out on hover or keyboard
          focus of this button, swapped for the reset chip below. */}
      <CubeDotIcon
        className="size-4 transition-opacity group-hover/mark:opacity-0 group-focus/mark:opacity-0"
        dotClassName="fill-current animate-override-bob motion-reduce:animate-none"
      />
      {/* The reset chip — a rounded green button face. Revealed on hover/focus; the
          stronger ring is keyboard-only (focus-visible) so a mouse hover stays quiet. */}
      <span
        aria-hidden
        className="absolute -inset-1 flex items-center justify-center rounded-md bg-daz-green/15 text-white opacity-0 ring-1 ring-inset ring-daz-green/30 transition-opacity group-hover/mark:opacity-100 group-hover/mark:bg-daz-green/25 group-focus/mark:opacity-100 group-focus-visible/mark:ring-2 group-focus-visible/mark:ring-daz-green/60"
      >
        <RotateCcw className="size-3.5" />
      </span>
    </button>
  )
}
