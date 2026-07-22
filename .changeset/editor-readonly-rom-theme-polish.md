---
"@dth/web": patch
"@dth/ui": patch
---

Editor polish + read-only per-scene ROM:

- **Non-primary scenes**: the ROM **Override** column stays visible but disabled (instead of vanishing), and row drag / insert / delete lock — so arming the scene's ROM override no longer shifts the morph grid sideways.
- **Darker, cooler theme** — the neutral-gray surfaces move to a deeper cool-slate ramp; the orange / green accents are unchanged.
- **Toggle switch restyle** — a squarer 4px track with an even knob rim and the orange on-state; row-delete bins are unified to one bordered `size-9`.
- **Sticky-chrome fixes** — section and column titles now pin flush under the collapsed header + tabs (`--chrome-h` set to the measured 196px), and the Notes tab's header no longer breaks apart when its short page can't scroll.
