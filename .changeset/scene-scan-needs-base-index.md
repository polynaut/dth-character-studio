---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

A scene morph scan no longer files the entire stock figure under the scene when
the machine has no base index for that generation. The scan reports what a scene
*adds* by subtracting the base index, so with nothing to subtract every stock
Genesis dial was landing in that scene's index — and since every ROM/export run
scans its scene, a plain export on a machine that had never built the base index
hit this silently, drowning the Parameter-name autocomplete with nothing saying
why. It now stops instead: Tools says to build **Base morphs** first, and an
export logs the skip without failing the row. Nothing is lost by waiting — a
later scan replaces a scene's contribution wholesale, so the first run after the
base index exists files it correctly.
