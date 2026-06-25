---
'@dth/web': minor
---

New **Tools → "Daz Studio & Houdini"** page to install and tidy your *own* Daz/Houdini content (a port of the dth-cli installers, minus the script-repo syncing). Lives under a new muted **Tools** nav item, separate from Settings.

- **Daz assets** — add multiple asset source folders (Genesis 3/8/9; `.zip`s read from the central directory, no extraction). Content-aware (`data`/`People`/`Runtime`/`Documentation`); copies only files that are missing or a different size, so re-runs are cheap and "already installed" is read from the real files (not guessed). Read-only **Scan** + per-asset expandable file lists. Shared files between *different* products auto-resolve on install — **newer Genesis wins, then the bigger file** — so only the winner is installed and folder order doesn't matter (your downloaded files are never edited).
- **Deduplicate** — finds duplicate / version assets (folder or `.zip`) and, on Apply, moves the redundant copies to a quarantine folder you choose (reversible; you pick which copy to keep). Conflicting shared files are shown read-only with the auto-resolved winner marked.
- **Custom morphs** + **Daz presets** — merge-only installs (add new files, never overwrite your edits), with source + destination folders.
- **Houdini presets** — replaces the presets folder in your Houdini docs folder and wires `houdini.env` (`SHARED_PRESETS` + `HOUDINI_PATH`).
- **Danger zone** — clean up leftover Daz folders after uninstalling Daz via Windows "Add or remove programs". "Prefill folder paths" adds the standard Daz locations that currently exist; a guarded "Uninstall Daz" deletes them (Dry run first; inline confirm).

Each section has a Dry run and a dismissible install report. The copy/scan/dedup run in native Rust (parallelized across assets).
