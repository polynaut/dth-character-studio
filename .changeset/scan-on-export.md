---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

The morph index now keeps itself up to date. Every ROM/export run scans the
scene it just verified, so the **Parameter name** autocomplete knows what a
scene wears without anyone remembering to run Tools → Scan project — the index
stays current through normal use alone. When the project has **Daz Products**
enabled, the same run also refreshes that scene's product scan.

Both scans happen right after the wrong-scene guard and before the ROM build,
where the scene is still exactly as you saved it, and both are best-effort: a
scan that can't run (an unsaved scene, no DIM folder) is logged in Daz and
never fails an export that otherwise succeeded. Runs whose open file is a saved
ROM animation still file their finds under the source scene.

Tools → Scan project stays for the bulk pass — a fresh project, or after
installing new morph packs.
