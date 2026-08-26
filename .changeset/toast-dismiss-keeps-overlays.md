---
'@dth/ui': patch
'@dth/web': patch
---

Dismissing a toast no longer closes the drawer or dialog under it. The toast
layer mounts outside the overlay's own DOM, so its close ✕ read as an
"outside click" — the drawer treated it as a backdrop dismiss. Clicks inside
the toast layer are now exempt from outside-click dismissal for both the side
panels and the dialogs.
