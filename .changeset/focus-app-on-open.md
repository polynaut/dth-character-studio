---
'@dth/desktop': patch
'@dth/web': patch
---

Bring the target app to the foreground after "Open in …". Opening a scene in an
already-running Daz Studio (or a Houdini `.hip` / Unreal `.uproject`) loaded it
behind the studio window; the studio now focuses the app's window afterwards. It's
best-effort and Windows-only — a no-op when the app isn't running yet (a fresh
launch focuses itself) or on other platforms.
