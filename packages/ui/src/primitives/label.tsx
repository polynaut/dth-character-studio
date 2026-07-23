"use client"

import * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { cn } from '../cn.ts'

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        // `min-h-6` reserves the height of an inline InfoPopup "i" (size-6) so every
        // label — with or without one — sits the same distance above its control
        // (items-center keeps the text vertically centred in that height).
        "flex min-h-6 items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
