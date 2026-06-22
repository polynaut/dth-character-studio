---
'@dth/web': minor
---

New **Optional** settings tab to install your *own* Daz/Houdini content (a port of the dth-cli installers, minus the script-repo syncing):

- **Daz assets** — add multiple asset source folders (Genesis 3/8/9; `.zip`s extracted). Content-aware (`data`/`People`/`Runtime`/`Documentation`); copies only files that are missing or a different size, so re-runs are cheap and "already installed" is read from the real files (not guessed). Plus a read-only **Scan** that reports how many files each asset would copy. Results are grouped by source folder, and each asset can be expanded to see the exact list of files that would be copied.
- **Custom morphs** + **Daz presets** — merge-only installs (add new files, never overwrite your edits), with source + destination folders.
- **Houdini presets** — replaces the presets folder in your Houdini docs folder and wires `houdini.env` (`SHARED_PRESETS` + `HOUDINI_PATH`).

Each section has a Dry run and an install report. The copy/scan run in native Rust.
