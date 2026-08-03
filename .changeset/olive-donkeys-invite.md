---
'@dth/web': patch
'@dth/ui': patch
---

**Replacing the primary Daz scene is now only offered while it is the character's only scene.** Every extra scene is validated against the primary when you add it — above all for the same GP/DK geograft, since each scene has to produce the primary's skeleton. Swapping the primary re-decides that reference, so a replacement without Golden Palace would leave a set of already-validated scenes quietly mismatched, with nothing to re-check them. The replace button stays visible but refuses, and its tooltip says what to do: unlink the other scenes, replace, then add them back — each one is properly validated against the new primary on the way in.
