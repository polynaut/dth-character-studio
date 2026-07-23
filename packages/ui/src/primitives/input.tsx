import * as React from "react"

import { cn } from '../cn.ts'

function Input({
  className,
  type,
  overridden,
  ...props
}: React.ComponentProps<"input"> & {
  /** Marks a per-scene override — a green border, kept while focused too. */
  overridden?: boolean
}) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/50",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        // A clearly-visible 2px red ring (not just the 1px border) so an invalid
        // field is obvious at a glance.
        "aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/50",
        // Keep the destructive border + ring while focused too — otherwise the
        // focus ring (equal specificity) hides the error state on the active field.
        "aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/50",
        // A per-scene override reads as a green border + green focus ring (so the
        // focus state doesn't clash with the override's green).
        overridden && "border-daz-green focus-visible:border-daz-green focus-visible:ring-daz-green/50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
