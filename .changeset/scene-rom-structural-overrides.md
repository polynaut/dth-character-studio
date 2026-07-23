---
"@dth/rom": patch
"@dth/web": patch
---

**Per-scene ROM overrides: edit freely, any divergence is an override.** On a non-primary Daz scene the ROM grid now edits exactly like the primary — add, insert, delete and drag-reorder frames, and add / remove / mirror whole groups. The previous limits (a non-primary scene could only retype an existing row or append a frame at a group's end) are gone.

- Every "overridden" mark is now derived by diffing the scene against the primary, never stored: a **row** whose content differs shows the green row + per-row reset (as before); a **section** whose frame count or order differs shows a green **overridden mark on its title** that resets the whole section back to the primary. The section enable/disable switch and preset-vs-custom mode still follow the primary.
- Under the hood the override's `poses`/`additions` deltas collapse into one per-section snapshot (`sections` on `sceneOverrideSchema`, schema v21): the scene's own groups for each section it diverges on. A migration folds existing overrides into the new shape, so generated `.dsa` + PoseAsset CSVs are byte-identical for characters that already had scene overrides.
