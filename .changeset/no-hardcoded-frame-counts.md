---
'@dth/rom': minor
---

**Frame alignment: preset-block lengths are never hard-coded.** The Daz runtime no
longer bakes in `iRomFrames 328/617`, `gpFrameCount 104`, `dk9FrameCount 54`,
`physFrameCount 43`. Instead the studio measures each block from the actual `.duf`
(it already did, for the CSV) and threads them into the generated script as
`presetFrames`; the runtime sizes every block from those measured counts and **fails
loud** (logs + aborts) if one is missing — so a custom or future-DTH preset of
non-standard length can't silently desync the Daz timeline from the PoseAsset CSV.

Guarded by two new tests: one fails CI if any frame-count literal reappears in the
runtime, and a cross-artifact property test proving the CSV and the Daz script derive
every custom frame's position from the same measured lengths across a config matrix.

Runtime bumped to **v16** — Tools → Refresh assets regenerates existing characters'
scripts to carry the measured `presetFrames`.
