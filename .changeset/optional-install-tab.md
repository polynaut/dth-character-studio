---
'@dth/web': minor
---

New **Optional** settings tab to install your *own* Daz/Houdini content (a port of the dth-cli installers, minus the script-repo syncing):

- **Daz assets** — add multiple asset source folders (Genesis 3/8/9; `.zip`s extracted). Content-aware (`data`/`People`/`Runtime`/`Documentation`), overwrites per asset, skips ones already installed. Plus a read-only **Scan**.
- **Custom morphs** + **Daz presets** — merge-only installs (add new files, never overwrite your edits), with source + destination folders.
- **Houdini presets** — replaces the presets folder in your Houdini docs folder and wires `houdini.env` (`SHARED_PRESETS` + `HOUDINI_PATH`).

Each section has a Dry run and an install report. The copy/scan run in native Rust.
