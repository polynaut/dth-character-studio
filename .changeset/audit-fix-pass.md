---
'@dth/web': minor
---

Full-app audit fix-pass: ~45 findings across the generation core, the native boundary, the UI, the Rust crate and the app's lifecycle.

Highlights (runtime v65 — Refresh regenerates the installed scripts):

- **The per-scene config lookup reads the open-scene capture.** A run from a saved ROM animation used to miss its scene's frame-layout override while delivering that scene's CSV — timeline and CSV disagreed on frames.
- **Reference-skeleton frames follow the open scene**, matching the per-scene CSV's bone-scale FBX paths.
- **Export failures reach the studio again**: they're filed into the v2 run log's per-scene runs (top-level pushes were invisible to the reader), CSV delivery failures are logged too, and the catastrophic-failure log merges per scene instead of truncating earlier scenes' failures.
- **Relocating the export root regenerates the scripts that bake it** — after a Houdini-subfolder change, exports no longer land silently in the vacated old root; changing the subfolder in Settings relocates and regenerates at save time.
- **A partial export-folder move keeps the failed folders in the record** and retries on the next save/Refresh instead of orphaning them silently; `move_exports` runs off the main thread (no more full-app freeze on multi-GB NAS moves) and never merges into a racing destination.
- **Project-tab Save no longer resets the Houdini path style to `$HIP`** (the field was missing from the save payload).
- **Project rename moves the generated Daz-script tree along**, so DTH Export keeps working without re-saving every character.
- Plus: a styled not-found page for moved/deleted projects, unlink dialogs default to keeping files on disk, the Houdini repair is reachable from its warning badge, orphaned per-character app data is swept, the recents list no longer silently drops projects from maintenance sweeps, the runtime install self-repairs deleted files, corrupt character definitions can be deleted in-app, the update dialog can be hidden while downloading, and many smaller hardening fixes (path-traversal guards, hex validation, zod-parsed IPC returns, fail-loud CSV import).
