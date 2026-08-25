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
through the normal outcome path (failure toast, files cleaned). An unclaimed
queued job with no editor is still just waiting — that is the normal
queue-then-open flow — and an unidentifiable editor keeps the import alive
rather than guessed dead.
