---
"@dth/web": patch
---

Per-scene ROM: reorder, insert and delete frames on a non-primary Daz scene. Drag handles and the insert "+" are no longer hidden there — the first structural edit (reorder / insert-between / delete a base frame / add a group) escalates the whole ROM section to a scene override. That section's title then shows a green overridden marker whose reset restores the section to the primary scene's ROM. Pure value edits keep the existing sparse per-row behaviour (green rows, per-row reset).
