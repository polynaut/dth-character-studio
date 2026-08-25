---
'@dth/web': patch
---

A crashed Unreal editor no longer leaves the DTH Export button Working
forever. The import's state is derived from files in the project's
`Saved/DTHStudio/` folder, so an editor that died mid-import — leaving a
claimed job and a result frozen at `running` — kept re-deriving a live
import on every poll, across app restarts, behind a deliberately inert
button. The poll now measures liveness for a CLAIMED import: when no editor
process exists at all, or every running editor is identified and none holds
that project, the import is reported as the failure it is and the run ends
through the normal outcome path (failure toast, files cleaned).

The verdict abstains wherever the studio cannot actually see: an editor whose
project can't be read might be the one running the import; a platform that
cannot enumerate editors at all (everything off Windows, where the probe is a
stub) decides nothing; a failed probe read is a read hiccup, not a dead editor;
and a job still queued unclaimed is just waiting — that is the normal
queue-then-open flow. A dead verdict also re-reads the result file before
believing itself, so an import that finished in the moment the probe took
is reported as the success it was.
