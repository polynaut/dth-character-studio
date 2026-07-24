---
'@dth/ui': patch
---

fix(ui): only show tooltips after a 700ms hover, with a stronger shadow

The global `title` → floating-tooltip host now waits 700ms (was 350ms) before a
hovered tooltip appears, so sweeping the pointer across the UI no longer flashes
tooltips. Keyboard focus still shows its tooltip immediately. Tooltips also sit
more elevated (`shadow-2xl`).
