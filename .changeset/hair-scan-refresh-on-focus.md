---
"@dth/web": patch
---

Hair items: re-read the scene's `.duf` when the studio window regains focus, so a
hair item added or removed in Daz shows up in the suggestions without switching
scenes. The native reader already reads the file live; the editor previously only
re-scanned on a scene-path change, so an edit made while sitting on a scene was
missed.
