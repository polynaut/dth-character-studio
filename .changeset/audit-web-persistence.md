---
'@dth/web': patch
---

**Persistence + safety fixes** (from a full app audit):

- **The one-time project-file migration no longer clobbers your settings.** When a project was unreachable (offline drive) during the migration, every relaunch re-wrote *all* the already-migrated projects' `.dcsp` manifests back to defaults — silently losing per-project settings (and, if `charactersSubdir` had been changed, hiding that project's characters). It now skips any project that already has a manifest.
- **Changing the characters subfolder now asks first** and moves atomically: it confirms before the (destructive) folder move, and pre-checks every destination for collisions before moving anything — so a collision partway through can't strand some characters at the new root while the manifest still points at the old one.
- **A manifest with no id gets a stable id** (persisted once) instead of minting a fresh one on every read.
- **"Open scene" only opens local scene/project files** (`.duf`/`.hip`), refusing arbitrary URLs — a shared character definition can't turn it into a phishing launcher.
- **External links go through one guarded helper**, so "open on GitHub"-style links also work in the plain-browser build (they previously threw outside the desktop app).
