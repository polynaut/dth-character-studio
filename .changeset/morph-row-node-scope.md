---
'@dth/rom': minor
'@dth/web': minor
---

Frame-0 and preserve morphs can be scoped to one scene item

The morph autocomplete always knew which item a suggested dial lives on — the
node badge on every suggestion — but picking one only kept the name. "Add
morphs on frame 0" then applied the row on **every** node carrying that name,
and auto-follow puts a figure morph's twin dial on every conformed item: a
`FBMExpandAll -100%` meant for a backpack deformed the boots, gloves and
holster too. "Preserve morphs" had the opposite failure — it only ever searched
the figure root, so a clothing morph listed there silently did nothing.

Both lists now carry an **Item** scope (schema v32, runtime v74). Picking a
suggestion sets it — the index knows which item a dial lives on — and the row
shows it as a read-only label whose ✕ clears the scope. Empty keeps each
list's old reach — every carrier for frame-0 rows, the figure root for
preserve rows — so existing characters generate unchanged. A scoped item
that isn't in the open scene logs a Daz-log warning naming it, never a run-log
failure, matching the lists' deliberately unvalidated design.
