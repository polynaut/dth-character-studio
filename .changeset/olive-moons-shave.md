---
'@dth/web': patch
---

Daz and Houdini paths follow their installation when it moves

Activating an installation in Settings derives its paths and writes them, and
they're shown read-only from then on. But the derivation was a one-time snapshot:
point the DAZ Install Manager at a different content library afterwards, and the
studio quietly carried on generating into the old one. Nothing said so, and the
only cure was re-clicking a card labelled "Active" — which invites nobody to click
it.

The paths are now re-derived whenever the installations are scanned, so a fresh
Settings visit (or **Rescan**) picks the change up on its own. Same for Houdini.

Two things it deliberately won't do: it never writes an empty value over a working
path — DIM dropping its manifests override shouldn't blank a path you depend on —
and it never persists your other unsaved edits, so with a dirty page the fresh
values land in the form and wait for your Save.
