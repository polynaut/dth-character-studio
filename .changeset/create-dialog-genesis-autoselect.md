---
"@dth/rom": patch
"@dth/web": patch
"@dth/desktop": patch
---

The **create-character dialog now auto-selects Genesis (and gender) from the picked Daz scene's contents** instead of guessing from its filename. Choosing or dropping a scene reads its base figure node (`Genesis9`, `Genesis8_1Female`, …) — which names both the generation and, for Genesis 8 / 8.1 / 3, the gender — and preselects the matching fields. A bare character scene (just the figure, no hair/clothes) is detected the same way. Both fields stay fully editable, so an unrecognized (e.g. renamed) figure just leaves the current selection in place.

The native `scene_wearables` command now also returns the scene's base `figure` node alongside its conformed items; the old filename-based generation guess is removed.
