---
"@dth/rom": patch
"@dth/web": patch
---

Block Save (and generation) on a custom pose name that isn't Houdini-safe, not just on empty fields. The Name cell already flags spaces/punctuation with a red border (Houdini accepts only letters, numbers and underscores), but the save gate only checked for empty fields — so a red-bordered name could still be saved. `romValidationErrors` now mirrors the cell rule, so a flagged field can't slip past Save.
