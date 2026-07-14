---
'@dth/web': patch
---

Keep spellcheck on the Notes field. Spellcheck is disabled app-wide (the technical
fields hold morph names and paths), but Notes are freeform prose, so re-enable it
there with `spellCheck` on the textarea to override the inherited default.
