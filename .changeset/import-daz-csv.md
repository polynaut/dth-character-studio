---
'@dth/web': minor
---

Import custom morphs from a DAZ-exported CSV. Every section that holds custom morphs (FBM, MISC, EXP, FAC, GEN, PHY) gets an **Import from CSV** button that parses a DAZ morph dump (`frame, , , node, prop, value …`) into poses — one per row, named from a cleaned form of the morph property (`xMusc_body_bs_AnconeusL_B_HD2` → `AnconeusL`, with the raw property kept on the morph) — so you no longer hand-enter long lists of individual morphs (muscles, veins, nails, expressions). Grouped sections get a new group; the flat FBM/MISC list appends to it.
