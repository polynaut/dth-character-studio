---
"@dth/web": minor
---

The character editor header now floats with a staggered, per-element pin: the
Back link scrolls away normally, while the Discard/Save buttons, the avatar and
the title each lock to the top at their own offset and their own scroll moment.
Driven by a transform-based scroll effect so the pieces stay in normal flow
(no layout jump) and each persists independently.
