---
'@dth/rom': patch
'@dth/web': patch
---

The DTH runtime is inline-config only now (runtime v27). The file-based config paths of the old wrapper-script era — the `extraJSONs` (`*_FBMs.json`) list, the GP9/DK9 art-direction JSON path fallbacks and the unused CSV reader — are removed; the runtime is studio-owned and everything arrives inline via the single `ApplyDTHCharacter(config)` call. A config that still passes file-based options aborts loudly with a regenerate-in-studio error instead of silently building a ROM without its custom frames. The GP/DK block-tail close-outs are unconditional now (their gating meta flags no longer exist — the option behind them was removed in the previous release), and the FBM-start art-morph reset is retired since the boundary close-out covers it. Dead migration code for the long-renamed `resetGPBeforeApplying` field is cleaned up too — old definitions still parse fine (unknown keys are stripped on read, as always).
