---
'@dth/web': patch
---

**Follow-ups to the rename cleanup.** Three fixes to what renaming a character reports and remembers.

The Houdini Utils drawer keeps a copy of every project it saves — that copy is what **Undo this run** restores, and what the drawer offers to clear when you close it. The new `retarget` operation's copies were missing from the list the drawer builds, so they would have been offered for neither. Nothing routes a retarget through the drawer today, so this was not reachable; it is fixed before it is.

Renaming a character that has **no exports yet** but does have a linked Houdini project now says what it is actually doing. It used to announce "Clearing the old exports…" when there were none, and then report back with a lower-case "repointed 1 Houdini project." asking you to *rebuild* a set that had never been built. It now says "Repointing the Houdini projects…" and "Repointed 1 Houdini project. Run DTH Export to fill them."

And when the rename cannot follow itself into one of your projects, the warning now tells you where the studio's copy of that project from just before the attempt is, instead of only suggesting you repoint the paths by hand.
