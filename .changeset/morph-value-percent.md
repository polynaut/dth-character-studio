---
'@dth/web': patch
---

Morph values (and the optional base value) are now shown and edited as Daz-style percentages (0–100%) with a "%" suffix, while still stored internally as 0–1 — so a stored value of `1` shows as `100%`, `0.5` as `50%`, matching Daz Studio's UI.
