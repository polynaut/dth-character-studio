---
'@dth/web': patch
---

Replacing a character's primary Daz scene now pre-selects the new scene's detected hair items, the same way creating a character, linking the first primary and adding an extra scene already did. A replacement is a different scene with different hair, so the new primary used to arrive with an empty hair list — and hair the studio is meant to keep out of the export rode straight into the FBX unless you remembered the wand. Trim the list in the editor if the guess overshoots.
