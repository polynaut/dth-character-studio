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

/**
 * The per-scene override marker on a Daz-scene-tied field's label: the cube glyph is
 * ALWAYS shown (so it also marks the field on the primary scene). Its dot is white
 * while the field matches the primary scene and turns Daz-green once the field is
 * overridden. Hovering the field's `group/ovr` swaps the glyph for a reset button
 * (click → back to the inherited value) — only when overridden, since there's
 * nothing to reset otherwise. The "can be overridden per Daz scene" hint lives here,
 * on the icon, not on the field.
 *
 * The 16px box is always rendered (no X/Y layout shift when a field goes overridden);
 * `-my-px` keeps it from growing a ~14px label row.
 *
 * Usage: wrap the label + field in `group/ovr`, drop this into the Label after the text.
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
  return (
    <span
      title={overridden ? undefined : 'Can be overridden per Daz scene'}
      className={cn(
        'relative -my-px inline-flex size-4 shrink-0 items-center justify-center text-foreground/85',
        className,
      )}
    >
      {/* The cube glyph. Dot white by default, Daz-green when overridden. On an
          overridden field it fades out on group hover so the reset can take over. */}
      <CubeDotIcon
        className={cn('size-4', overridden && 'group-hover/ovr:opacity-0')}
        dotClassName={overridden ? 'fill-daz-green' : 'fill-current'}
      />
      {overridden && (
        <button
          type="button"
          onClick={onReset}
          title={resetTitle}
          aria-label={resetTitle}
          className="absolute inset-0 flex items-center justify-center rounded text-daz-green opacity-0 outline-none transition-opacity group-hover/ovr:opacity-100 hover:text-[color-mix(in_oklab,var(--color-daz-green)_80%,white)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-daz-green/50"
        >
          <RotateCcw className="size-3.5" />
        </button>
      )}
    </span>
  )
}
