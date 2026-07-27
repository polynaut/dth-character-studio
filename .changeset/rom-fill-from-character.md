---
"@dth/web": minor
---

The character editor's Operations card gains a "Fill" button (beside
Delete): a two-step wizard that copies ROM sections from any character in
any known project. Step 1 picks the
source character (same generation + gender, like the create dialog's ROM
prefill), step 2 picks which of its filled sections to copy — the checked
sections replace the current config in the editor draft. GEN keeps the
target's scene-derived geograft setup (enabled state + GP/DK selection);
only its art direction / custom frames copy over.

The create-character panel's "ROM prefill" dropdown is replaced by the same
Fill wizard: pick the source and its sections, create applies them onto the
new character's defaults. Step 2 also offers opt-in "Also copy" extras —
the Modify-JCM-frames rules, the G9 strength dials and the preserve-after-
ROM lists (each pre-checked when the source has them). Hair scenes and
scene overrides no longer copy on prefill: both are keyed by the source's
own scene paths and sat inert on the new character.
