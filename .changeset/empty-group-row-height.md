---
"@dth/web": patch
---

Fix a layout shift when adding the first pose to an empty ROM group. The "No poses in this group yet." placeholder was taller than a real pose row, so adding the first morph made the list jump. The empty state now matches a pose row's height.
