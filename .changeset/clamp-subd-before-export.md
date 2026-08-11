---
# minor: the generated scripts now WRITE scene state they never touched before
# (permanently, by design) — new behaviour, not a fix to something broken.
'@dth/rom': minor
'@dth/web': minor
---

**The ROM and export scripts clamp Mesh Resolution before they export.**

`Render SubD Level (Minimum)` drives the Alembic cache's mesh resolution, so a single fitted item left above 1 silently multiplies the geometry that reaches Houdini. It is per-node state, on every wearable independently, and invisible unless you click each node in the Scene pane — which is how a scene drifts into it without anyone deciding to. Measured on a real Genesis 8.1 scene: the figure and twelve wearables at 1, and the geograft quietly sitting at 2.

Every generated ROM script — and the split `Export_…` script, which runs without the ROM build — now walks the figure and everything fitted to it and writes **SubDivision Level** and **Render SubD Level (Minimum)** down to 1 wherever they are higher. What it changed is listed by node in the Daz log, so the run says what it did rather than altering the scene silently.

**The clamp is kept, not put back.** It runs before the `rom-animations` copy is saved, so that scene carries the clamped values — which is the point: opening it later and exporting by hand cannot reintroduce the bloat. This is the one place the scripts deliberately leave your scene changed, and it is why it says so in the log.

Two things it will not do. A node whose **Resolution Level** is *Base* ignores the SubD levels entirely, so it is named and left alone rather than "fixed" by flipping its resolution — that is a bigger change than clamping a level. And a level that is **animated** is reported instead of written: setting it would land a keyframe at the current time, and that key would ride into the export, which is worse than the problem being solved.

Runtime v70 — **Tools → Refresh assets** installs it and regenerates the character scripts.
