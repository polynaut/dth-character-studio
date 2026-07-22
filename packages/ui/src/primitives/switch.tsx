import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from '../cn.ts'

function Switch({
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
  /** "green": a squared-off green/white toggle for the on-green override pills
   *  (matching the SceneLabel tile's rounding). "default" is the app's
   *  grey/orange squared switch everywhere else. */
  variant?: "default" | "green"
}) {
  const green = variant === "green"
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center border shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6",
        green
          // Disabled: a muted grey-green track (not a washed-out fade), no inner
          // shadow — reads as a distinct locked control (the thumb goes white below).
          ? "data-[size=default]:h-[1.15rem] rounded-[5px] border-[color-mix(in_oklab,var(--color-daz-green)_60%,black)] shadow-[inset_0_1px_2.5px_rgb(0_0_0/0.28)] data-[state=checked]:bg-[color-mix(in_oklab,var(--color-daz-green)_78%,white)] data-[state=unchecked]:bg-[color-mix(in_oklab,var(--color-daz-green)_16%,white)] disabled:border-[color-mix(in_oklab,var(--color-daz-green)_50%,#5f5f5f)] disabled:bg-[color-mix(in_oklab,var(--color-daz-green)_45%,#808080)] disabled:shadow-none"
          : "data-[size=default]:h-5 rounded-[4px] border-transparent data-[state=checked]:bg-[#fe5c01e0] data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80 disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0",
          green
            ? "rounded-[3px] shadow-sm data-[state=checked]:bg-white data-[state=unchecked]:bg-[color-mix(in_oklab,var(--color-daz-green)_72%,white)] group-disabled/switch:bg-white"
            : "rounded-[3px] bg-background dark:data-[state=checked]:bg-white dark:data-[state=unchecked]:bg-foreground"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
