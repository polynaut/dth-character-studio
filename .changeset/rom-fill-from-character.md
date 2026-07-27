---
"@dth/web": minor
---

The animation timeline panel gains a "Fill" button: a two-step wizard that
copies ROM sections from any character in any known project. Step 1 picks the
source character (same generation + gender, like the create dialog's ROM
prefill), step 2 picks which of its filled sections to copy — the checked
sections replace the current config in the editor draft. GEN keeps the
target's scene-derived geograft setup (enabled state + GP/DK selection);
only its art direction / custom frames copy over.

The create-character panel's "ROM prefill" dropdown is replaced by the same
Fill wizard: pick the source and its sections, create applies them onto the
new character's defaults. Prefill now copies exactly the picked ROM
sections — no longer the source's preserve lists, hair scenes, JCM rules or
strength dials (scene-tied data that pointed at the source's scenes anyway).
