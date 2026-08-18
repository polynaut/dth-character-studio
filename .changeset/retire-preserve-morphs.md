---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

"Preserve morphs after ROM loading" is gone (schema v35, runtime v83).

Current DazToHue releases hold those morph values across the ROM load by
themselves, so the studio's own restore pass had nothing left to do — and it was
not harmless: it FLATTENED each listed morph's whole animation to the hold value
at the very end of the build, so a morph that was both preserved and posed as a
ROM frame lost its posed keys.

**Morphs set at frame 0** moves to the top of the Advanced options panel, where
the retired list sat — it no longer has a panel of its own. Below it, Advanced
options keeps **Preserve node transforms** (the memorize-before / restore-after
pass for posed nodes like the eyes), which is untouched — per-scene overrides,
the Fill wizard's "Also copy" extras and the character-zip import all keep it.

Existing characters upgrade on read: the stored morph list is dropped, and a
per-scene preserve override that existed only because its morph list differed is
dropped with it, so no scene is left silently pinned to an old node-transform
list. Tools → Refresh assets reinstalls the runtime and regenerates the scripts.
