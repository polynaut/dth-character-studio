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
