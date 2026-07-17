---
'@dth/rom': minor
'@dth/web': minor
---

Scene-derived avatars stay in sync with their Daz scene. Daz rewrites a scene's preview image on every scene save, but the studio copied it exactly once — now the character remembers which linked scene its avatar mirrors (schema v12, additive `imageScene`), and the editor re-copies the preview whenever it drifts: on opening the character and every time the app window regains focus (tabbing back from Daz is enough — no reload needed). Custom-uploaded images and external URLs are never touched, and picking a different linked scene's preview in the image dialog re-targets the sync to that scene. Characters created before this release self-heal: when the stored avatar still matches a linked scene's current preview, that scene is adopted as the source automatically.
