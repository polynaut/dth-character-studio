import { cloneElement, isValidElement, useId } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { Label } from '../primitives/label.tsx'
import { cn } from '../cn.ts'

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
  controlId: explicitControlId,
  className,
  children,
}: {
  label?: ReactNode
  error?: ReactNode
  /**
   * The id of the labelable control inside `children`, for when the control is
   * NOT the direct single-element child — an input inside a wrapper div, or a
   * Radix Select (whose `Root` renders no DOM and drops `id`; put the id on the
   * `SelectTrigger` instead). The automatic clone-wiring below only works on a
   * direct DOM child — on anything else it silently labels nothing. An explicit
   * `controlId` wins over the auto-wiring; when `error` is used too, the error
   * line's id is `${controlId}-error` so the caller can point the control's
   * `aria-describedby` at it (Field can't reach inside `children` to set it).
   */
  controlId?: string
  className?: string
  children: ReactNode
}) {
  const generatedId = useId()
  const errorId = `${explicitControlId ?? generatedId}-error`
  // Wire the label to its control: htmlFor needs an id on the child, and the
  // error line needs aria-describedby — without them the label isn't clickable
  // and assistive tech never hears the field name or its error. Only possible
  // when the child is a single element; an explicit child id wins.
  let control = children
  let controlId = explicitControlId
  if (explicitControlId === undefined && isValidElement(children)) {
    const props = children.props as { id?: string; 'aria-describedby'?: string }
    controlId = props.id ?? generatedId
    // MERGE the error id with a child-supplied aria-describedby (the attribute
    // takes a space-separated id list) — preferring the child's would silence
    // the error for assistive tech.
    const describedBy = props['aria-describedby']
    control = cloneElement(children as ReactElement<Record<string, unknown>>, {
      id: controlId,
      'aria-describedby':
        error !== undefined ? (describedBy ? `${describedBy} ${errorId}` : errorId) : describedBy,
    })
  }
  return (
    <div className={className}>
      <Label
        htmlFor={label ? controlId : undefined}
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
        {control}
        {error !== undefined ? (
          <p id={errorId} className="mt-1 min-h-4 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
