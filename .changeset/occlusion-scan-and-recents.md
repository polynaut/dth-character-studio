---
'@dth/web': patch
---

**Fixes the occlusion tabs' first real outing, and makes Recently used removable.**

**"No DazToHue occlusion nodes in this project" about a project full of them.**
The Utils drawer reads a cached scan, and the cache key records *what the scan
was asked*. Teaching the scan to see the occlusion node types changed the
question without bumping that version, so every project scanned before the
feature shipped kept serving its old answer — a node list with the material and
skeleton nodes and no occlusion ones — and looked perfectly fresh doing it. The
version is bumped, so the next look re-earns the answer. (Nothing to do by
hand: the entries invalidate themselves.)

**"3 target nodes selected" under one ticked box.** The drawer preselects every
node of the card it was opened from — all kinds at once — and the run counted
them all, so an occlusion transfer was pointed at the project's material and
skeleton nodes too. The Python refuses a wrong-typed node per target, so nothing
was ever written to one; the count and the report were the lie. Targets are now
filtered to the tab's own kind, matching the list you can actually see and tick.

**Each transfer tab explains itself.** The material node's texture-baker
paragraph was printed at the top of every tab, including both occlusion ones —
a note about bakers and UV names above a list of occlusion settings. And *"A
occlusion section is copied wholesale"* now reads *"An occlusion section"*.

**Recently used sources can be removed.** The row fills itself from every source
ever picked, including the one-off look, so it needed a way out: each chip has a
✕ that drops it. Removing a shortcut is not removing a file — the `.hip` is
untouched, and picking it again puts it straight back at the top.
