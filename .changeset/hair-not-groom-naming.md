---
"@dth/web": patch
"@dth/rom": patch
---

Consistent naming: in the Daz side it's "hair", not "groom" (it only becomes a "groom" downstream in Houdini/Unreal). The standalone hair-export script is now `Export_Hair_<Name>_<Genesis>.dsa` (was `Export_Groom_…`), and every user-facing Daz string — the generated script's log/dialog lines, the character editor's hair section, and the guide — reads "hair". The Houdini-bound artifacts keep their downstream term: the exported `_grooms.abc` and Houdini's DazToHueGroom Import are unchanged. Regenerating a character sweeps the old `Export_Groom_…` script from its folder. The guide's hair section also drops the stale unfit/refit + "Solve hair assets by hiding" wording (hiding has been the single mechanism since the Exporter Plugin 2.0.1 change).
