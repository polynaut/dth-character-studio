---
"@dth/web": patch
---

Fix a bogus "not found / unlisted hair" warning that flashed for one frame when switching Daz scenes. The scene's hair scan now resets during render — the instant the selected scene changes — instead of in an effect, so a render never judges the new scene's hair list against the previous scene's wearables.
