---
'@dth/rom': minor
'@dth/web': minor
---

feat(rom,web): the scene card's **Open in Daz** now offers the saved ROM animation. Clicking the open button shows a small menu: **Open Original**, and **Open ROM Animation** when the scene's saved `.ROM_Animations/<stem>_ROM.duf` exists and is current — when it's missing, stale (the scene changed since its last handoff) or **Ctrl** is held, the entry reads **Open and Generate ROM Animation**: the Runner opens the scene, builds the ROM through the new hidden ROM-only script (`.Build_ROM_Animation.dsa`, runtime v43 — no export), and the freshly saved animation opens by itself. Also: an open-scene handoff whose Daz turned out to be closing now launches Daz directly once the process is gone, instead of showing the close-Daz dialog.
