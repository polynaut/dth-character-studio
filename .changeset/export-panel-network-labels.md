---
'@dth/web': minor
'@dth/desktop': minor
'@dth/rom': minor
---

DTH Export names the jobs each project will contribute, before the run starts

The panel's Houdini rows now carry one chip per **DazToHue network** the stored
scan says that project writes, and the Unreal rows one chip per **character**
this run would land in that project. So the size of a run — two networks in one
`.hip`, one character re-imported and another dropped — is readable before
pressing Start, instead of only once the task list has filled in.

The two lists answer different questions, and the rows are worded for it. The
Houdini chips describe the **project**: they stand whether the row is ticked or
not, and under "Skip Houdini", which runs no Houdini leg at all. The Unreal
chips describe **this run**, already narrowed to the sets the studio located in
that project — the send is re-import only, so those are exactly the import jobs
the run will queue for it.

Both stay silent where the studio cannot say: an unscanned Houdini project names
nothing rather than claiming it writes none, a run that produces no export names
no characters rather than promising the stale folder on disk, and a set the
Unreal project has never held is left off, because the run would drop it too.
