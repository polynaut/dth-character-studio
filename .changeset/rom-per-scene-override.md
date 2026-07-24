---
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

feat: override anything in the ROM per Daz scene

A non-primary ("outfit") Daz scene can now override the WHOLE ROM, not just custom rows
and enable/disable — mode, preset asset, GEN art direction, custom JCM path, and the
"Modify JCM frames" grid are all per-scene now. Editing any of them on a non-primary
scene makes the scene own that section's config; the field greens, the section title
carries the reset handle, and its reset restores the primary. The Add group / Import
buttons are live per-scene too, so an outfit can build up its own section.

Generation embeds each scene's FULL config delta into the one character script (the diff
of the scene's config vs the base), so the script still looks its dataset up by the open
Daz scene name at runtime and falls back to the primary. This also fixes a real desync in
the previous per-scene enable/disable: dropping a *preset* section for a scene now emits
`bIncludeGP/DK/Physics:false`, so Daz and Houdini agree on the frames (before, Daz still
built the block the CSV dropped). Character schema 22 → 23 (migrated on read); the
migration now heals a preset-only section (RET) so a legacy override can't hard-fail load.
A section disabled-then-customized for a scene (or the mirror) now re-toggles correctly —
`enabled` no longer had two sources of truth that could disagree.

Editor polish in the same pass: overridden field labels + ROM section titles read
Daz-green; the grid reset/bin buttons get a visible hover silhouette (bin reddens on
hover, reset centers); preserve rows mute when inherited and drop their placeholders; the
Hair field gets the green override border; and the ROM timeline label is now "Animation
timeline". The docked scene-footer pills now show each scene's original `.duf` filename
stem (matching the Daz-scene cards) instead of a name-stripped, spaced label.
