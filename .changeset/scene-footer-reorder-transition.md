---
"@dth/web": patch
---

Animate the scene-footer rail on selection. Picking a pill now swaps it into the
prominent slot with a quick View Transitions morph — each pill slides from its
old slot to its new one instead of snapping — while the rest shift to fill in.
Falls back to a plain select where the API is unavailable or the user prefers
reduced motion.
