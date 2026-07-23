---
"@dth/web": patch
---

**Preserve lists: one override mark in the label** — the Advanced-options preserve lists (morphs, node transforms) now carry a single override cube in each list's **label**, exactly like the other Daz-scene fields, instead of one in front of every row. On a non-primary scene a list counts as overridden the moment it differs from the base as a whole — any changed hold value, an added row, or a removed one — turning its label cube green and greening the rows; the reset there reverts the **whole list** to the base scene. The `preserve.enabled` gate and generated output are unchanged.
