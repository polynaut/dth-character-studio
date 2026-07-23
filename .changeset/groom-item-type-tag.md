---
"@dth/web": patch
"@dth/ui": patch
---

Hair-item picker now colour-codes each scene item by its guessed type — Hair
(violet), Clothing (sky), or Graft (amber). The dropdown suggestions carry a
pastel type badge, and each selected pill is filled with its type's pastel
colour, so it's easy to tell real hair from the outfit items it's mixed in with.
The type is a best-effort guess from the item's label (the scene file carries no
authoritative asset type). `MultiSelect` gains generic `optionBadge` and
`pillClassName` slots for the badge and the per-type pill fill.
