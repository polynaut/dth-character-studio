---
'@dth/web': minor
'@dth/rom': minor
'@dth/desktop': minor
---

App-styled tooltips everywhere. Every `title` attribute in the app now shows a
proper tooltip — rounded, drop-shadowed, on the app's popover surface, smartly
positioned by Floating UI (flips/shifts at viewport edges) — instead of the
browser's plain native tooltip. One global host intercepts hover/focus, so all
existing and future `title=` usage migrates automatically; keyboard focus shows
the tooltip instantly, and icon-only controls keep an accessible name.
