---
"@dth/web": patch
---

When creating a character and choosing to copy the Daz scene into the project,
the character's stored `scenePath` now points at the in-project copy rather than
the original external file (matching the editor's relink behaviour). Previously
it kept the external path, so "Open in Daz" would open the outside-the-project
original.
