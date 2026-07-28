---
"@dth/web": patch
---

Pose rows in a disabled ROM section can no longer be drag-reordered: Chromium
still delivers pointer events to disabled buttons, so the drag handles slipped
through the read-only fieldset — they're pointer-dead in that state now.
