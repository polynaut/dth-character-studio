---
# patch: one question removed from an existing dialog — no new capability, no
# change to what a generated project contains.
'@dth/web': patch
---

**The first Generate project no longer asks which Daz scene to import.**

A character's first Houdini project is its main one — wired to the primary scene, which is what everyone answered anyway. The **Daz scene to import** picker now appears from the **second** project on, where "which scene's export set?" genuinely differs (one project per outfit scene). A single-scene character stays unasked, as before; unlink every project and the next generate counts as the first again.
