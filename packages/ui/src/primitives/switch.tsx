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
        "peer group/switch inline-flex shrink-0 items-center transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6",
        green
          ? "border shadow-xs focus-visible:border-ring data-[size=default]:h-[1.15rem] rounded-[5px] border-[color-mix(in_oklab,var(--color-daz-green)_60%,black)] shadow-[inset_0_1px_2.5px_rgb(0_0_0/0.28)] data-[state=checked]:bg-[color-mix(in_oklab,var(--color-daz-green)_78%,white)] data-[state=unchecked]:border-[color-mix(in_oklab,var(--color-daz-green)_38%,#3a3f47)] data-[state=unchecked]:bg-[color-mix(in_oklab,var(--color-daz-green)_34%,#5b6472)]"
          // Neumorphic pill: a recessed track (inset shadow) cradling a raised,
          // subtly-domed knob (drop shadow + top-to-bottom gradient). The 2px
          // side padding + `calc(100%-4px)` travel keep the knob evenly inset in
          // both states (track width = 2× knob for every size, so the offset is
          // size-agnostic).
          : "rounded-full px-[2px] data-[size=default]:h-5 data-[state=checked]:bg-[#fe5c01] data-[state=checked]:shadow-[inset_0_1.5px_2.5px_rgb(0_0_0/0.38),inset_0_-1px_1px_rgb(255_255_255/0.18)] data-[state=unchecked]:bg-[#2b2f37] data-[state=unchecked]:shadow-[inset_0_1.5px_3px_rgb(0_0_0/0.6),inset_0_-1px_1px_rgb(255_255_255/0.05)]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=unchecked]:translate-x-0",
          green
            ? "rounded-[3px] shadow-sm data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=checked]:bg-white data-[state=unchecked]:bg-[color-mix(in_oklab,var(--color-daz-green)_8%,white)]"
            : "rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.5),0_2px_4px_rgb(0_0_0/0.4)] data-[state=checked]:translate-x-[calc(100%-4px)] data-[state=checked]:bg-[linear-gradient(to_bottom,#ffffff,#e0e4ea)] data-[state=unchecked]:bg-[linear-gradient(to_bottom,#d8dce2,#a8adb5)]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
