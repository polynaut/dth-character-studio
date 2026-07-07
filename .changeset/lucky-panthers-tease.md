---
"@dth/web": patch
---

Fix batch: character notes now follow renames and moves (`<Name>.notes.md` is renamed with the definition in save/move/library-root moves, and removed with a loose definition on delete — previously a rename silently orphaned the notes); the unsaved-changes guard now intercepts the native window close (Tauri's ✕ never delivered `beforeunload`); the selection pill floats above the Unreal footer bar instead of overlapping it; styled tooltips track live `title` changes so PathCode's "Copied!" feedback actually shows; non-G9 characters carry an "experimental" chip until the G8/G8.1 CSV path is validated in Houdini.
