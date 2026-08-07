---
'@dth/web': patch
'@dth/desktop': patch
---

After an elevated install, one click back to normal — drag-and-drop works again

Installing the Exporter or Runner plugin into Program Files means running the
studio as administrator — and Windows then silently blocks drag-and-drop from
Explorer into the elevated window: drops just do nothing, with no error. The
moment an elevated install succeeds, the studio now says so and offers
**Restart normally**: the launch is handed to Explorer (so the new instance
runs at your normal level, like a double-click), the current project reopens
via its `.dcsp`, and drops work again. Nothing shows on a dry run, a failed
install, or a normal-elevation session.
