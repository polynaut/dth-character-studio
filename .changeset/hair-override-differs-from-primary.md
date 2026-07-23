---
"@dth/web": patch
---

**Hair items marks as overridden when it differs from the primary scene.** On a non-primary Daz scene the Hair field's Daz-scene glyph now goes green (with the override dot) exactly when that scene's hair list differs from the primary scene's — compared as a set, the same test the other per-scene fields use — instead of whenever the scene simply listed any hair. A deliberately bald outfit scene (empty list against a primary that has hair) now reads as overridden too, and the glyph's reset copies the primary's list back so the two match again.
