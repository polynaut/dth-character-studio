---
'@dth/web': patch
'@dth/desktop': patch
---

The Houdini project card now catches a PoseAsset node reading another export set's CSV. The export always delivers the PoseAsset CSV beside the set it belongs to under the set's own name, so a project whose PoseAsset still points at a different set's CSV — typically an older project wired before its scene grew per-scene ROM overrides — imports the wrong frame layout the moment the scenes diverge, silently. The background scan now reads each PoseAsset's CSV path together with its own network's import, and the card badges the mismatch with the exact path to point the node at. Existing scan results re-earn themselves on the next visit to the character page.
