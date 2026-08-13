---
'@dth/web': minor
---

**Houdini project checks now catch baker textures whose file is gone.**

A missing texture was the one failure in this pipeline that reported itself as
success. Measured on DazToHue 2.5 / Houdini 22.0: point a material baker's layer
texture at a file that does not exist, press Bake, and the Houdini console prints

```
DazToHue: export started
DazToHue: baking material textures
DazToHue: export finished in 0:00:02
```

No dialog, no node error, nothing in the log. The HDA is black-boxed so the cook
itself can't be read, but its bake path can — `do_bake_material_textures` is a
bare `cook(force=True)`, and the whole material PythonModule holds exactly one
`os.path.exists`, in the texture browser's drag-and-drop handler. There is no
check to inherit. The first sign was a wrong-looking character in Unreal.

The card badge and the Utils drawer's General tab now report it. Like the import
check, it is deliberately SCOPED — to the material node's
`material_texture_baker_layer_texture*` parms — because "the file is missing" is
not a usable definition of broken across a whole `.hip`: a healthy project names
four of Houdini's own scratch files that simply don't exist until used. Measured
on a real project (11 bakers, 43 layers): 51 of the material node's 86 file
parms are these, and all 51 resolve. Zero false positives.

Unlike everything else the badge reports, this one has no repair button, and
that is on purpose — the fix is outside the studio (reinstall the product, or
restore the library). It earns the badge anyway, because nothing else in the
pipeline will tell you. The wording says so rather than letting "missing" read
as something Houdini would have caught.

Also fixed alongside it: a project hython could not open shipped a `refs` block
without `hipRelative`, which the schema requires — so a single unreadable `.hip`
failed the parse of the whole scan report and took every other project in the
sweep with it.
