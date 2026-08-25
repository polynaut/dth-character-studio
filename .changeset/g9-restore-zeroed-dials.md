---
'@dth/rom': patch
'@dth/web': patch
---

G9 characters keep their dialed pose-control shape through the ROM build
(runtime v101). DTH's G9 base ROM presets carry explicit zero keys for ~700
value channels the ROM never walks — every stock breast pose control among
them — so a character's dialed 100% "Breasts Up-Down" read 0% across the
whole generated ROM, and a hand-fix at frame 0 died at the preset's next
zero key. (The G8/G8.1 presets carry none of these channels, which is why
the retired "Preserve morphs after ROM loading" option looked obsolete.)

The runtime now restores such dials automatically, with no option or list:
after all preset blocks, a root-figure dial that was non-zero before the ROM
loaded and whose keys are ALL zero afterwards (zeroed flat — never walked)
is flattened back to its pre-ROM value. Genuinely walked channels have a
non-zero key somewhere and are never touched; ERC-driven halves are left to
their master. A flat channel matches the base mesh on every frame, so the
FBX and Alembic artifacts stay aligned. Run Tools → Refresh assets to
regenerate installed scripts onto the new runtime.
