---
'@dth/web': patch
---

The character header portrait now sits right for Genesis 3, 8 and 8.1.

Daz doesn't frame every generation the same way in the tip image it renders — a
G3/G8/G8.1 figure comes out sitting noticeably higher in the square than a G9
one. The header pan was tuned against G9, so on those characters it clipped the
top of the head and left a band of empty tile under the chin. They now get their
own resting and collapsed offsets; G9 is unchanged.

The smaller portrait tiles elsewhere still use one crop for every generation and
are unchanged here.
