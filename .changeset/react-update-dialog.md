---
'@dth/web': patch
---

**The "update available" prompt is now an in-app dialog** instead of the native OS
dialog. When a new version is found, the confirm is rendered in React in the app's
own style (matching the other dialogs) — with the version, release notes, and
**Later** / **Update now**. The dialog also shows a "Downloading and installing…"
state while it works and surfaces any install error inline, then restarts the app.
