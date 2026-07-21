---
'@dth/web': patch
---

The sticky headers on the character page and the Settings / Tools pages now have a liquid-glass background — a translucent fill with a heavy backdrop blur, so content scrolling beneath frosts through them, echoing the native macOS title bar above. Falls back to the opaque background where `backdrop-filter` isn't supported.
