---
'@dth/desktop': patch
---

**Harden the native file operations** (from a full app audit):

- **Uninstall Daz can no longer wipe your Documents.** The "Prefill" list stopped deriving a delete candidate from the *parent* of your DAZ library (typically your whole Documents folder) — it now lists the library folder itself. On top of that, `uninstall_daz`, `empty_folder` (quarantine), and the housekeeping sweep now refuse to recursively delete a drive/profile root or a too-shallow path, and the uninstall additionally refuses any folder that isn't Daz-owned ("DAZ" in the path) — so even a corrupt settings value can't trigger a catastrophic delete.
- **Recursive walks no longer follow symlinks/junctions**, so the housekeeping sweep can't escape its tree to delete files elsewhere and can't loop forever on a junction cycle.
- **Houdini presets now MERGE** instead of deleting the destination folder first — a mis-named source can't wipe an arbitrary Houdini subfolder, and a mid-copy failure can't leave a half-install.
- **`houdini.env` is never clobbered** on a read error / non-UTF-8 content (it used to treat an unreadable file as empty and overwrite it).
- **DazToHue-Scripts install swaps atomically** (old moved aside, restored on failure) instead of delete-then-copy.
- **Dedup keeper selection fixed**: the Genesis rank read the *last* number in the folder name, so "_genesis 9 (2024)" ranked 2024 and the "newer Genesis wins" rule silently inverted — it now reads the first number after "genesis". Name collisions in the quarantine are disambiguated instead of silently leaving a duplicate installed.
- Window-management commands recover from a poisoned lock, and opening a project holds the window map lock across the whole find→allocate→insert so two racing launches can't map to the wrong window.
