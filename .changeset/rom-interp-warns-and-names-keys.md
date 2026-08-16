---
'@dth/web': patch
'@dth/rom': patch
---

A ROM run no longer cancels its export over a handful of stubborn keys — and it
tells you which keys they were.

Measured on LaraCroft G8.1 (DS 4.24): a ROM+export run reported `4 of 7968
key(s) would not read back LINEAR`, and exported **nothing**. That line was
filed as a run error; a run error makes the ROM "not clean"; and the generated
script exports only when the ROM built clean. The batch row still finished as
`done`, so what the user saw was a completed run, an empty export folder, and no
reason short of opening the Daz log — while the character's Houdini scene failed
its load-time cook for the FBX that was never written. The only way to
regenerate it was another full ROM run, which hit the same gate every time.

**Interpolation findings are now warnings, and the export runs.** A key that
kept Daz's default interpolation still holds its own value, so every ROM pose
frame is exact — only the motion *between* pose frames on that channel differs,
which a PoseAsset export does not sample. What still fails a run is a key whose
**value** could not be restored, because that one does make a pose frame wrong.
A Daz build too old to read interpolation back also warns rather than blocks:
"this Daz cannot answer the question" is not evidence that the answer is bad.

**Every unfixable key is now named** — node path, dial (with its Parameters
path), key index, frame, and the interpolation Daz actually reports instead of
Linear, e.g. `CONSTANT (1)`. Previously there was only a count, which nobody
could act on: not the node, not the dial, not the frame. The list is capped per
kind so a pathological run cannot flood the Daz log, with the exact totals in
the message, and it goes into the run log the studio reads back — not only into
the Daz log. The channels that keep an implicit frame-0 key are named the same
way, with the reason each was left alone.

The studio shows warnings as prominently as errors: the character page's run
report now appears for a run that exported *and* had something to say, in amber
instead of red, with the same button in the sticky header.

Not yet re-run in Daz — the behaviour is pinned by tests that drive the shipped
runtime over the measured Daz semantics (`setKeyInterpolationType` does nothing,
`setValue` is what rewrites a key), but the next real ROM run is what will show
the named keys for the 4 that started this.

Regenerate the character (Tools > Refresh assets) and re-run the ROM to pick
this up: runtime 78 -> 80.
