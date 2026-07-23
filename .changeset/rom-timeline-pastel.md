---
"@dth/web": patch
---

ROM timeline bar now uses soft pastel (`-300`) block colors instead of the
saturated `-600`/`-700` fills, which read as too vibrant against the dark UI.
Block labels flip to dark text so they stay legible on the lighter blocks, and
the segment dividers ease from `black/20` to `black/10`. Section hues are
unchanged in family (RET slate, JCM indigo, …), so each block keeps its identity.
