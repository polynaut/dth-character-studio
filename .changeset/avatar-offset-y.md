---
'@dth/web': minor
'@dth/rom': minor
---

The character image dialog gains a **vertical offset**: a slider (plus a number box and a Reset) that moves that character's picture up or down in every avatar and scene thumbnail in the app at once. Daz frames a figure in the previews it renders according to how tall that figure is, so a short or tall character comes out sitting high or low in the square and every crop of it misses the face by the same amount — one number now fixes all of them. The dialog shows two previews side by side while you tune: the stored square image, and how the character header will frame it.

The value is a percentage of the picture itself rather than a pixel nudge, which is what lets a single setting land the same crop in the 224px header portrait and in a 32px scene chip. It defaults to 0 — the framing every character already had — so nothing moves until you move it.

This replaces the per-Genesis-generation framing shipped in 0.83.0, which was the wrong model: the generation was never what decided it. Every character is back on one default crop, corrected per character where it needs correcting.
