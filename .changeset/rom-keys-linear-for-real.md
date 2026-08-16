---
'@dth/web': patch
'@dth/rom': patch
---

Every ROM key is written LINEAR — including the one at frame 0.

Measured on a shipped ROM animation (DS 4.24): of its 292 morph channels, 230
came out CONSTANT and only 62 LINEAR, and all 1298 transform channels were
CONSTANT. The split was never two kinds of morph — the CONSTANT ones are exactly
the channels mrpdean's ROM **presets** key, which arrive carrying the
interpolation stored in the preset `.duf`, and the LINEAR ones exactly the
channels the runtime creates itself. The pass meant to make them agree had two
faults: it skipped node properties wholesale (to protect transforms — but every
control dial lives there, ~190 channels), and on the ones it did walk,
**`setKeyInterpolationType` changed nothing at all** — measured over 7747 keys,
in both overloads, with no error.

What works, measured the same way, is rewriting the key through
**`setValue(t, v, LINEAR)`**: the interpolation argument is what lands, it is a
no-op unless the value changes (so the value is nudged off and put back
exactly), and it holds at any time and inside an undo hold. That is what the
pass does now, reading every key back to confirm rather than assuming.

A few channels can never be re-keyed — locked transforms (`min == max`) and
hidden ERC controllers refuse the nudge. Measured, every one of them is a single
key at frame 0, where interpolation spans nothing. They are counted and
reported separately instead of being treated as failures.

Frame 0 is fixed too. Daz serializes a channel whose first real key sits later
as `[0, value]` with no interpolation element, and such a key **loads back as
TCB** — a spline key, not the Linear one the ROM intends. Those keys are now
written explicitly.

Transform and bone channels are included, on the same reasoning: values at the
keyed pose frames are identical under either interpolation, so only the motion
*between* pose frames changes. The pass also covers every node under the figure
— geografts and conformed clothing carry keys the run wrote too.

Two long-standing latent bugs fell out of this: `DzProperty.Linear` does not
exist on DS 4.24, so all three places the runtime passed it — the two
`Scene.setDefaultKeyInterpolationType` calls and, the one that actually decides
a key's interpolation, `setPropertyByName`'s `setValue(t, v, interp)` — had been
handing Daz an undefined enum; and the key-interpolation pass had been silently
ineffective for as long as it has shipped.

One consequence to know about: with the session default finally getting a real
constant, running a ROM script leaves your Daz creating **Linear** keys
afterwards. The ROM does not depend on it — every key is stamped explicitly —
but it is a setting the script changes and does not put back.

The pass now reports only what it can prove. A key whose value will not move is
called harmless only where this scene confirms it is that channel's one key at
frame 0; anywhere else it is a logged failure. A Daz build that cannot read
interpolation back gets "rewritten, unverified" rather than a clean bill. A
nudge that cannot be put back is reported as the value problem it is, ahead of
any interpolation complaint. And with no LINEAR constant available at all, the
pass stops before touching the scene instead of nudging every value for nothing.

Verified on a real ROM (LaraCroft G8.1, DS 4.24): 292 of 292 morph channels and
1298 of 1298 transform channels come out LINEAR on every key, frame 0 included,
with no channel missing its first-key interpolation — and every key value,
including each morph's base and its full-strength spike, identical to before.

Regenerate the character (Tools > Refresh assets) and re-run the ROM to pick
this up: runtime 76 -> 78.
