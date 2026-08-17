---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

The ROM now fails loudly when a walked morph is dialed in the scene — and the
autoBase/base sawtooth floors are gone (schema v34, runtime v82).

Measured root cause of the FBX/Alembic base-shape drift: the DTH Exporter's
FBX pass excludes every morph whose ROM keys vary from the base mesh — on the
scripted and the dialog export path alike — while the Alembic bakes the true
timeline. A non-zero sawtooth floor (the v31 autoBase feature, or a manual
`base`) therefore always shipped a shaped Alembic base against an unshaped FBX
base, and shrank the HDA-generated morphs to the leftover dial headroom.

Now the sawtooth floor is always 0, and a new build-time gate fails every
frame that walks a morph dialed non-zero at frame 0 (tolerance 0.001, ERC-
driven dials called out so you zero the controlling dial). The failures ride
the run log: the offending frames turn red in the studio with the reason, and
the export is skipped — a drifting export can no longer be produced silently.
Zero the dial in the export scene (its shape reaches Unreal through the
generated morph, now at full range) and rebuild.
