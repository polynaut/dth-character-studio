---
'@dth/web': patch
---

Generate project now says which Daz scene it is generating for. A generated Houdini project is defined by the scene whose export set it imports, but the dialog only ever named it when it asked — and it deliberately doesn't ask for a single-scene character, or for a character's first project. Both cases now state the scene (and mark the primary), the line updates as you pick on the ones that do ask, and the confirmation names it too, so the answer survives the dialog closing.
