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
  /** "green": the same neumorphic pill in Daz-green — marks an "override" boolean
   *  (e.g. a per-scene overridden field). "default" is the app's orange switch
   *  everywhere else. Both share the one recessed track + raised domed knob. */
  variant?: "default" | "green"
}) {
  const green = variant === "green"
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        // Neumorphic pill: a recessed track (inset shadow) cradling a raised, subtly
        // domed knob. The 2px side padding + `calc(100%-4px)` thumb travel keep the
        // knob evenly inset in both states (track width = 2× knob for every size, so
        // the offset is size-agnostic).
        "peer group/switch inline-flex shrink-0 items-center rounded-full px-[2px] transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-5 data-[size=default]:w-8 data-[size=sm]:h-3.5 data-[size=sm]:w-6",
        // Recessed track (shared inset shadow both states).
        "data-[state=unchecked]:shadow-[inset_0_1.5px_3px_rgb(0_0_0/0.6),inset_0_-1px_1px_rgb(255_255_255/0.05)] data-[state=checked]:shadow-[inset_0_1.5px_2.5px_rgb(0_0_0/0.38),inset_0_-1px_1px_rgb(255_255_255/0.18)]",
        // Accent — orange (default) or Daz-green (override) when checked. When OFF the
        // green variant keeps the normal neutral track; its "overridden-but-false" cue
        // is instead a light-green KNOB (see the thumb below).
        green
          ? "focus-visible:ring-daz-green/50 data-[state=unchecked]:bg-[#2b2f37] data-[state=checked]:bg-[color-mix(in_oklab,var(--color-daz-green)_86%,black)]"
          : "data-[state=unchecked]:bg-[#2b2f37] data-[state=checked]:bg-[#fe5c01]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.5),0_2px_4px_rgb(0_0_0/0.4)] ring-0 transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=unchecked]:translate-x-0 data-[state=checked]:translate-x-[calc(100%-4px)] data-[state=checked]:bg-[linear-gradient(to_bottom,#ffffff,#e0e4ea)]",
          // Off-but-overridden reads via a light-green domed knob (the track itself
          // stays the neutral off colour); otherwise the usual silver knob.
          green
            ? "data-[state=unchecked]:bg-[linear-gradient(to_bottom,#bfe9cf,#8ecfa6)]"
            : "data-[state=unchecked]:bg-[linear-gradient(to_bottom,#d8dce2,#a8adb5)]",
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
