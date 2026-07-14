---
'@dth/web': patch
---

Add a reliable way to open a character's scene when Daz Studio is already running.
The studio can't switch a running Daz's scene itself (a forwarded open is dropped
once a scene is loaded), so generation now writes a per-character
`Open_Scene_<Character>.dsa` into the Content Library that opens the scene from
inside Daz (replacing the current one, after a save warning). Clicking a scene card
while Daz is open now shows a dialog pointing at that script, with an "Open anyway"
that still forwards (which works when Daz has no scene loaded). With Daz closed,
cards open as before.
