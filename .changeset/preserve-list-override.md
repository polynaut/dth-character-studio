---
'@dth/web': patch
---

fix(web): preserve overrides use one control per list, in the label

The Advanced-options preserve morphs / node transforms showed an override cube in
front of every row. The override is per-list (the `preserve.enabled` gate is derived
from "the list differs"), so move it to one control in each list's label — like the
other fields. The whole list counts as overridden the moment any row's value changes
or a row is added/removed; reset reverts the list to the primary, and a green border
still marks the individual rows that differ.
