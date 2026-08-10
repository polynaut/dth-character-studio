---
# minor: a new remembered list and a new shortcut row, plus a warning that
# fired on a normal, correct transfer.
'@dth/web': minor
---

**Utils drawer: a "Recently used" row for transfer sources.** The source of a material or skeleton transfer is nearly always the same personal template, re-browsed from scratch every time. The last five are now offered as chips under the picker, in both the Material and Skeleton tabs, so the second use is one click. They are remembered per machine (a template usually lives outside any project), files that have since disappeared are filtered out, and re-picking one moves it back to the top.

**An empty target node no longer reads as a figure mismatch.** Copying materials into a freshly generated project — a DTH network with no material slots yet — put an amber warning in the confirm dialog listing every incoming surface as "exist on no slot here" and telling you to check both nodes are the same figure. They were: with no slots there, every surface is unclaimed by arithmetic, and setting an empty node up from a template is the normal reason to run a transfer. The preview now stays silent, and the post-run report no longer says it about surfaces the run had just created.

**Clearer explanations.** The Generate-project popup says what it creates in four short lines (network wired, `$JOB` on the character folder, `$HIP` on the project's own folder where `daz-export` lives) and names your project's actual Houdini subfolder instead of assuming "houdini". The Project-checks popup drops the version history for what its two repairs do. A Houdini `.hip` is called a *project* throughout, never a "scene". And Rescan sits next to the section title rather than after the count.
