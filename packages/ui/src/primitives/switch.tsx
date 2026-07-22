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
   *  grey/orange rounded-full switch everywhere else. */
  variant?: "default" | "green"
}) {
  const green = variant === "green"
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center border shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        green
          ? "h-[1.375rem] w-9 rounded-[5px] shadow-[inset_0_1px_2.5px_rgb(0_0_0/0.28)] data-[state=checked]:border-[color-mix(in_oklab,var(--color-daz-green)_45%,gray)] data-[state=unchecked]:border-[color-mix(in_oklab,var(--color-daz-green)_45%,black)] data-[state=checked]:bg-[color-mix(in_oklab,var(--color-daz-green)_78%,white)] data-[state=unchecked]:bg-[color-mix(in_oklab,var(--color-daz-green)_16%,#959595b8)]"
          : "rounded-[5px] border-transparent data-[size=default]:h-[1.15rem] data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0",
          green
            ? "size-[1.125rem] rounded-[3px] bg-white shadow-[0_1px_3px_rgb(0_0_0/0.3)]"
            : "rounded-[3px] bg-background group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 dark:data-[state=checked]:bg-primary-foreground dark:data-[state=unchecked]:bg-foreground"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
