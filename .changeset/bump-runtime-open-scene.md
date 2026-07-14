---
'@dth/rom': patch
---

Bump `RUNTIME_VERSION` (20 → 21) so **Refresh assets** flags every existing
character stale and regenerates it — installing the new per-character
`Open_Scene_<Character>.dsa` script for characters created before that feature. No
runtime `.dsa` file changed; the bump is purely to trigger regeneration.
