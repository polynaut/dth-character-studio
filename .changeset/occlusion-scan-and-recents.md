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

**No material knobs on a folder-kind run.** The confirm dialog offered
**Replace UV channels and bakers** on both occlusion tabs — a material control
the occlusion transfer never reads (a folder section is always copied
wholesale), above a line about material slots merging by surface. And the
success toast reported a folder run's outcome in material terms, which came out
as *"Copied 0 slots, 0 channels, 0 bakers"* after a transfer that worked. Both
now say what the run actually did.

**Recently used sources can be removed.** The row fills itself from every source
ever picked, including the one-off look, so it needed a way out: each chip has a
✕ that drops it. Removing a shortcut is not removing a file — the `.hip` is
untouched, and picking it again puts it straight back at the top.

**The drawer's outcome toasts stay until you dismiss them.** Every one of these
reports a run that took hython tens of seconds and wrote to your projects —
exactly the stretch during which nobody is watching this window. A toast that
timed out while you were in Houdini took the only summary of what a
transfer/repair/repath did with it. Errors too: a failure that scrolls past
unseen is worse than a success that does.
