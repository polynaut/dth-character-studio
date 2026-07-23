import { RotateCcw } from 'lucide-react'

import { cn } from '../cn.ts'

/**
 * The per-scene override marker shown inside an overridable field's Label: a small
 * green dot while the field is overridden, which swaps to a reset icon-button when
 * the surrounding `group/ovr` is hovered (or the button is focused). Clicking it
 * resets the field to the primary scene's (inherited) value.
 *
 * The slot is ALWAYS rendered (a fixed 16px box) and only filled when overridden —
 * so a field going overridden never grows its label (no X/Y shift of the field or
 * its neighbours). `-my-px` keeps the 16px box from growing a ~14px label row.
 *
 * Usage: wrap the label + field in an element with `className="group/ovr"`, drop
 * `<OverrideMark overridden={…} onReset={…} />` into the Label after the text.
 */
export function OverrideMark({
  overridden,
  onReset,
  className,
}: {
  overridden: boolean
  onReset: () => void
  className?: string
}) {
  return (
    <span
      aria-hidden={!overridden || undefined}
      className={cn(
        'relative -my-px inline-flex size-4 shrink-0 items-center justify-center',
        className,
      )}
    >
      {overridden && (
        <>
          {/* The resting marker — a green dot, faded out on hover. */}
          <span
            className="size-2 rounded-full bg-daz-green transition-opacity group-hover/ovr:opacity-0"
            aria-hidden
          />
          {/* The reset control — revealed on hover of the field group, or when focused. */}
          <button
            type="button"
            onClick={onReset}
            title="Reset to the primary scene's value"
            aria-label="Reset to the primary scene's value"
            className="absolute inset-0 flex items-center justify-center rounded text-daz-green opacity-0 outline-none transition-opacity group-hover/ovr:opacity-100 hover:text-[color-mix(in_oklab,var(--color-daz-green)_80%,white)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-daz-green/50"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </>
      )}
    </span>
  )
}
