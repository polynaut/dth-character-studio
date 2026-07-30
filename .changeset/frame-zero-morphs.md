---
'@dth/rom': minor
'@dth/web': minor
---

feat: "Add morphs on frame 0" — a new character panel listing morphs (name + value) the generated script sets and keys at frame 0, on every node of the figure tree that carries the morph (the figure and each fitted item) — so one clothing row like "Expand All" reaches whichever outfit pieces the open scene wears. Overridable per Daz scene (a full-replacement list, presence-armed like the preserve lists), and deliberately unvalidated: a scene without a listed morph just skips it. Schema v28, runtime v44 — Refresh assets regenerates existing scripts.
