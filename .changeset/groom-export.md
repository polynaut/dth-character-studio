---
'@dth/rom': minor
'@dth/web': minor
---

Groom workflow: one scene can carry full hair while the ROM export stays clean. A new "Groom items" list on the character's Export section names the fitted hair items (usually just the cap — its children ride along); the generated script unfits + unparents each one right before the DTH Exporter runs and restores it afterwards, even when the export fails. This is the measured mechanism — the exporter walks the selected figure's hierarchy and ignores visibility, so hiding hair never worked; a mistyped label aborts the export loudly instead of silently shipping a hair-polluted FBX. With groom items listed, generation also writes an experimental `Export_Groom_<Name>.dsa` that exports just the hair at frame 0 as Alembic for the Unreal groom path (requires Daz's Alembic Exporter add-on, reported clearly when missing). Character schema v12 (additive `groomNodes`, no migration needed).
