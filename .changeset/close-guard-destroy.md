---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
---

Confirming "Yes" on the unsaved-changes dialog when closing the window now
actually closes it. Registering a close-requested listener makes Tauri hold
every close and destroy the window from the JS side afterwards — and that
destroy call needed a permission the app never granted, so the window
silently stayed open.
