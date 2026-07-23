---
'@dth/web': patch
---

feat(web): enable/disable a ROM section per Daz scene, + scene-override editor polish

Dropping a section for one outfit used to mean clearing its whole row list. The
section on/off toggle is now live on a non-primary scene: flipping it stores a
`sceneOverride.sectionEnabled` entry (only when it differs from the primary), and the
section reads as overridden like every other field — green title handle, and its reset
restores the primary's on/off state. `applySceneOverride` flips the base section's
`enabled` per entry (mode/groups untouched), so the section drops from the scene's
frames + CSV while the base is unchanged; works for preset sections too, no custom row
list needed. Schema 21 → 22 (additive, no migration).

Same-pass editor consistency:

- Preserve-morph / node-transform rows mute to gray when inherited on a non-primary
  scene and go white + green when overridden; deleting a row surfaces the override on
  the list label (no row left to mark).
- The Hair-items field gets the green override border when its list differs from the
  primary scene.
- The overridden section toggle wears the green switch variant, and its tooltip is the
  standard "can be overridden per Daz scene" hint; the primary-scene toggle drops its
  redundant tooltip.
- Renamed the ROM timeline label to "Animation timeline".
