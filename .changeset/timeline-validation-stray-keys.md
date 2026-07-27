---
"@dth/web": patch
"@dth/desktop": patch
---

The "Empty timeline" scene check no longer trips over stray product keys.
Wearables routinely leave a few animation keys on their own bones (e.g. the JM
Nipple graft keys frames 0–7 in every scene it's used in), which read as "8
frames of animation" on a scene whose timeline is actually untouched. The
native scene read now counts only channels that really change value AND don't
belong to a fitted wearable's node chain — real hand-animation on the
character still fails the check.
