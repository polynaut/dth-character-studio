---
"@dth/web": patch
---

Fix five bugs in the bundled DTH Daz runtime (`DthUtils.dsa`), surfaced from a generated ROM script's log:

- **Fence poses restored at bogus frames.** `setFencePoses` iterated the fence-frame array with `for…in`, which in Daz's script engine also yields enumerable `Array.prototype` members — restoring the figure at `function f(){…}` (NaN time) and `""`. Switched to an indexed loop so only the real fence frames are restored.
- **"Too many arguments" flood.** `getValueChannel(0)` logged `Too many arguments, ignoring 1` on every morph lookup (the method takes no args). Dropped the argument.
- **Art-direction "Property not found".** Morph resolution now falls back to `findProperty`/`findPropertyByLabel`, so geo-graft "preset" morphs exposed on the figure as alias properties (e.g. Golden Palace `GP_PR_*`) resolve instead of being skipped.
- **False "Failed to set property".** `setPropertyByName` verifies by reading the value back instead of trusting `setValue`'s return, so a no-op (value already at target, e.g. FACS Detail Strength) no longer logs a false failure.
- **Implicit-global hygiene.** `oProp`/`oMod`/`oMorph`/`oContentMgr` are now proper `var` declarations, silencing the "used before declaration" warning.
