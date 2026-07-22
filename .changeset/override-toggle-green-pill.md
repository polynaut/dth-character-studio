---
"@dth/ui": patch
"@dth/web": patch
---

The per-scene override toggle is now one integrated control: the switch is folded into the green scene-label pill (at its right edge, with a subtle divider) instead of sitting beside it. A new `Switch` `variant="green"` styles it to match — squared-off corners like the pill tile, an inset shadow, and green/white hues (a green track + white knob when on; a pale track + green knob when off) in place of the default grey/orange. The global default switch is unchanged.
