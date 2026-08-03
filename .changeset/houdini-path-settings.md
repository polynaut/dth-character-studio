---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

The `dth-exports` junction and `$HIP` paths are explained up front and decided
per project. The **first Generate project** in a project now explains, right in
the dialog, the two things it is about to set up — the `dth-exports` shortcut
(an NTFS junction some source-control setups dislike) and `$HIP`-relative
reference-skeleton paths — with a link to the extended guide, and asks how this
project wants them.

Both answers are saved as **project settings** (Settings → Project), editable
anytime: *Create dth-exports shortcuts* and *Houdini path style*. With
shortcuts off, none are created or repaired and absolute paths are forced —
the tree stays free of reparse points for Perforce and junction-hostile backup
tools. The path style moved from the app-wide Settings page to the project,
where it always belonged.

The guide's junction notes grew into a proper chapter with copy-paste ignore
rules for Git and Perforce (including the P4 caveat that ignores only apply on
add).
