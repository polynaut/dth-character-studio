---
"@dth/web": patch
---

The "unsaved changes — leave and lose them?" prompt and the "move character folders?" confirm now render in the app's own themed modal (focus trap, Escape/backdrop = cancel, "Leave"/"Move folders" buttons) instead of a native OS dialog. A single `ConfirmProvider` hosts an app-styled, promise-based confirm at the root, so both the route-navigation guard and the Tauri window-close (✕) path go through it; the native `confirmDialog` helper is gone. The browser-reload `beforeunload` prompt stays native — it can't be styled and only affects the web build.
