---
"@dth/web": patch
---

Per-scene ROM: reorder, insert and delete frames on a non-primary Daz scene. Drag handles and the insert "+" are no longer hidden there — the first structural edit (reorder / insert-between / delete a base frame / add a group) escalates the whole ROM section to a scene override. That section's title then shows a green overridden marker whose reset restores the section to the primary scene's ROM. Pure value edits keep the sparse per-row behaviour (green rows, per-row reset), and editing a value back to the base (e.g. a bone-scale flag toggled on then off) now un-arms the row instead of leaving it stuck green. An overridden row's bone-scale checkbox reads green to match the row.
