---
'@dth/web': patch
---

Preserve morphs now hold across the WHOLE ROM; frame-0 morphs apply first

Two ordering fixes in the ROM build. "Preserve morphs after ROM loading" ran
right after the base ROM preset — before the DK/GP/Physics blocks and the
custom frames, so anything those later stages keyed won over the preserved
value: the G8.1 Physics block keys the breast dials to 100%, and a 60% hold
showed 100% on those frames. The restore now runs after every key-laying
stage and flattens the listed morphs across the whole timeline — and it no
longer sits inside the JCM branch, so a ROM without the base block preserves
too (it previously skipped the restore entirely).

"Add morphs on frame 0" applied after the preset blocks; it now applies at
the very beginning of the build, so the frame-0 fit is the base state
everything else builds on — including the passes that read scene values (the
close-out baseline and the Auto sawtooth floors, which never saw frame-0
morphs before).
