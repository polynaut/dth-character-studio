---
'@dth/web': patch
---

A DTH Export run that finishes into Unreal now ends when the **editor** answers,
not when the job file is written. Writing that file takes a moment; the import
that follows takes minutes — so the run reported "DTH Export finished in 8m 15s"
over a progress bar that said the editor was half way through, and the two sat
on screen together. Worse, the report tore the run panel down on its way out, so
the next thing the import said rebuilt it with no task rows at all: a bare
progress bar, ghosting a run that had already been declared over.

The run's last leg is the import, so the report waits for it and carries its
outcome as the report's last line — one report for the whole run, with the time
the import itself took, instead of a finish toast and a separate outcome toast
minutes apart. Nothing waits when there is nothing to wait for: a send that was
refused, or a run with no Unreal project selected, reports the moment its export
legs are done, exactly as before.

The panel that now stays up for the wait keeps the run behind it: the Daz scenes
and Houdini projects that finished stay ticked off and retire out of the list —
and a leg that **failed** keeps its red row — instead of all of them dropping
back to "waiting" and running the progress bar backwards.

And an import that can never answer no longer takes the report down with it. If
the job disappears before the editor picks it up, the run reports what its export
legs really did and says the import's outcome is unknown, rather than waiting
forever behind a job that is gone.
