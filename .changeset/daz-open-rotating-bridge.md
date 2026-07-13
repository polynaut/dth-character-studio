---
'@dth/web': patch
---

Fix "Open in Daz" sometimes not loading the scene when Daz is already open. The
scene-open bridge always wrote the same `dth_open_scene.dsa`, and a running Daz can
ignore a repeated open of an identical path — so a second click looked like nothing
happened. The bridge filename now rotates across a small fixed pool, so consecutive
opens never hand Daz the same path twice.
