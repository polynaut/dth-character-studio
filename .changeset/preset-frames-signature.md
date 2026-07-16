---
'@dth/rom': patch
'@dth/web': patch
---

Toggling the FAC section now re-measures the preset ROM block lengths in the character editor. The FAC preset steers which JCM base asset the ROM resolves to (with vs. without the facial block), but the editor's re-measure trigger didn't watch it — so the timeline and frame numbers could show the stale previous length until an unrelated change. The trigger's field list now lives in `@dth/rom` next to the path resolution itself (`presetFramesSignature`), with a test coupling the two so a future resolver input can't silently go missing again.
