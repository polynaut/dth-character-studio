---
"@dth/web": patch
---

Hair items: a new ✦ button beside the multiselect selects every detected hair
item in one click (clearing the current pick first). Switching to an outfit
scene whose `.duf` contains hair its list doesn't cover now auto-arms that
scene's hair override and warns which item would otherwise ride into the export.

Also: the remove (bin) buttons in Advanced options and next to the export
directory now match the height of the fields beside them and drop their hover
tooltips; and a keyboard reload (Ctrl/Cmd+R, F5) while there are unsaved changes
now goes through the app's own "Unsaved changes" modal instead of the browser's
native, unstyleable reload prompt.
