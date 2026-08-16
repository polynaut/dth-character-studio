---
'@dth/web': patch
'@dth/rom': patch
---

ROM keys are stamped LINEAR for real — including the one at frame 0.

Measured on a shipped ROM animation (DS 4.24, runtime v76): of its 292 morph
channels, 230 came out CONSTANT and only 62 LINEAR. The split was never two
kinds of morph — the CONSTANT ones are exactly the channels mrpdean's ROM
**presets** key (`pCTRL*`, `CTRL*`, `facs_ctrl_*`, `facs_jnt_*`, `facs_bs_*`),
which arrive carrying the interpolation stored in the preset `.duf`, and the
LINEAR ones exactly the channels the runtime **creates** itself. The pass that
was supposed to make them agree missed most of them and silently failed on the
rest: it skipped node properties wholesale (to protect transforms — but every
control dial lives there, ~190 channels), and on the 43 blendshape morphs it did
walk, `setKeyInterpolationType` changed nothing at all, without an error.

So the pass now walks the node's own channels too, resolves the LINEAR constant
against the running Daz instead of trusting one spelling of the enum, **reads
every stamp back** and rewrites the key through `setValue` when it didn't take,
and counts what it could not set into the run log rather than reporting a clean
run. It also covers every node under the figure — bones, geografts and conformed
clothing carry keys the run wrote too, and a root-and-mouth pass never saw them.

Transform channels are included: all 1298 of them in that same file were
CONSTANT, uniformly, from the same presets. Nothing in the pass moves a value —
a stamp changes interpolation only, and the fallback restores exactly what it
read — so values at the keyed pose frames are unchanged. What changes is the
shape of the motion **between** pose frames.

Frame 0 is fixed as well: Daz serializes a channel whose first real key sits
later as `[0, value]` with **no** interpolation, so that key fell back to
whatever default the reader has. Each such channel now gets a real frame-0 key
at the value it already held — and it is rolled back if the value moves at all,
so an ERC-driven morph can't be double-applied.

Regenerate the character (Tools > Refresh assets) and re-run the ROM to pick this
up: runtime 76 -> 77.
