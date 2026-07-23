---
"@dth/web": patch
"@dth/ui": patch
---

**Inline per-scene overrides** — every overridable panel drops its per-panel "OVERRIDE" toggle. On a non-primary Daz scene an overridable field is now editable inline: it shows the primary scene's value muted (with a "can be overridden per Daz scene" hint), and editing it to a value that differs makes it a per-scene override — a green border + a green dot that swaps to a reset button on hover. Global fields (Gender) stay editable on any scene.

- **Identity dials** (FACS / flexion strengths, UE5 tear UV) — green-on-edit per dial; hover the dot for a reset to the inherited value.
- **ROM grid** — the Override checkbox is gone; editing a base row arms it (the row turns green) with a reset button beside remove; the section structure stays locked.
- **Preserve lists** (Advanced options) — per-item green + reset; rows are matched to the base by their natural key (morph name / node label), so reordering or deleting one never mismarks the others.
- **Hair** — the toggle is gone and the list is always editable. Hair is per-scene by nature (no "primary" to inherit from), so it keeps no override chrome.

Generation is untouched: the per-scene gates (`identity.enabled`, ROM `enabled`, `preserve.enabled`) are now derived from "a value differs from the primary," so the `.dsa` + Houdini CSV output is byte-identical.
