---
'@dth/rom': patch
'@dth/web': patch
---

The base ROM's last pose no longer leaks into the blocks after it (runtime v26). A pose preset can only key frames inside its own range, so the base block's final FAC pose — a neck morph — had no ramp-down key past the block end and held its value through everything that followed, visible as neck/throat morph deltas across the whole GEN range in Houdini. After the base block loads, the runtime now keys any morph not back at its frame-0 value to that value at the first post-base frame (figure and G9 mouth alike), completing the sawtooth the preset couldn't author. Re-run the character's ROM script in Daz to rebuild existing timelines; Tools → Refresh assets flags characters generated on older runtimes as stale.
