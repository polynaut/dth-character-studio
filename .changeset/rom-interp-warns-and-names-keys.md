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

One class of finding turned out not to be a finding at all. A key that is its
channel's ONLY key, at frame 0, interpolates across nothing — there is no second
key to travel to — so whether the stamp took cannot change any value anywhere.
That exemption previously applied only to keys whose value REFUSED to move,
which was an accident of the scene it was measured on rather than a property of
spans. The first real run proved it: all four of its findings were single keys at
frame 0 on `Bone Fill Opacity` / `Bone Edge Opacity` — viewport drawing dials
under `/Display/Scene View/Bones` that nobody had animated, which reach the walk
only because Daz reports an implicit frame-0 key for never-keyed channels. Those
four are now correctly counted as spanning nothing, and each reported key also
carries its channel's key COUNT, so "does this interpolation span anything?" is
answerable from the report instead of requiring a scene to open.

Regenerate the character (Tools > Refresh assets) and re-run the ROM to pick
this up: runtime 78 -> 80.
