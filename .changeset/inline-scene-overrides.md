---
"@dth/web": patch
"@dth/ui": patch
---

**Inline per-scene overrides** — the Genesis-9 identity dials, hair, and the ROM grid drop their per-panel "OVERRIDE" toggles. On a non-primary Daz scene an overridable field is now editable inline: it shows the primary scene's value muted (with a "can be overridden per Daz scene" hint), and editing it to a value that differs makes it a per-scene override — a green border + a green dot in the label that swaps to a reset button on hover. Global fields (Gender) stay editable on any scene.

- **Identity dials** (FACS / flexion strengths, UE5 tear UV) — green-on-edit per dial; hover the dot for a reset to the inherited value.
- **ROM grid** — the Override checkbox is gone; editing a base row arms it (the row turns green) with a reset button beside remove; the section structure stays locked.
- **Hair** — the toggle is gone and the list is always editable. Hair is per-scene by nature (no "primary" to inherit from), so it keeps no override chrome.

Generation is untouched: the per-scene gates (`identity.enabled`, ROM `enabled`) are now derived from "a value differs from the primary," so the `.dsa` + Houdini CSV output is byte-identical.
