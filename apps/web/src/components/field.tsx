import type { ReactNode } from 'react'

import { Label } from '#/components/ui/label.tsx'
import { cn } from '#/lib/utils.ts'

/**
 * A labelled form field with inline validation. Pass `error` to show a small
 * message below the control in the theme's decent dark-mode red (`--destructive`,
 * a soft coral — not a harsh red). Set the same `aria-invalid` on the control so
 * its border turns the matching red — the `Input` / `Button` components already
 * style `aria-invalid`.
 *
 * With no `label`, the label line is kept as invisible spacing so the control
 * still lines up with its labelled neighbours in a shared `items-start` row
 * (e.g. a separator or a button sitting between labelled inputs). The error sits
 * below the control and doesn't shift sibling columns.
 */
export function Field({
  label,
  error,
  className,
  children,
}: {
  label?: ReactNode
  error?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      <Label
        className={cn('mb-1 block', !label && 'invisible')}
        aria-hidden={label ? undefined : true}
      >
        {label ?? ' '}
      </Label>
      {/* Control + error share a wrapper so the message lines up on the control's
          left edge. When an `error` prop is provided the slot is always rendered
          with a reserved min-height — even while valid (empty string) — so an
          error appearing later doesn't shift the layout. */}
      <div>
        {children}
        {error !== undefined ? (
          <p className="mt-1 min-h-4 text-xs text-destructive">{error}</p>
        ) : null}
      </div>
    </div>
  )
}
