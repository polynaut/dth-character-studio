---
'@dth/web': minor
---

New Daz script: **Kill_Animation** — rescue an old scene that is only a ROM

A scene the studio can use needs an empty timeline, which makes an old character
that survives *only* as its full ROM animation unusable as it stands. The new
bundled `Kill_Animation` script is the way back: open the old scene, run
`Scan_Frames` to capture the ROM frame by frame, then run this to get the
character back on its own. It deletes every key in the scene and puts the
animation range back to the default 0–30 frames — the figure keeps its shape,
its clothes and the pose it holds at frame 0; only the timeline goes. It shows
you what it found and asks before deleting anything, never saves the scene
itself, and names any property that refused to give up its keys rather than
reporting a clean run over a scene that still has animation in it. Installs into
`Scripts/DTH-Character-Studio` on the next Save or Tools → Refresh assets.
