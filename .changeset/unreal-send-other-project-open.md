---
# bump: patch is deliberate — fetchUnrealOpenEditors() is plumbing for the launch
# decision this fix corrects (a queued import waited forever behind another open
# project); the send-to-Unreal capability itself shipped in v0.75.
'@dth/web': patch
'@dth/desktop': patch
---

Fix: a DTH Export whose Unreal project is not the one already open no longer sits unclaimed forever. The studio can now read WHICH projects the running Unreal editors have open (their command lines name their `.uproject`), so a queued import job opens its own project next to a different one instead of refusing to launch because "an editor is running" — and the run's status line says what actually happened in every case: opened, opened beside the running editor, target open but not claiming (restart the editor if the Runner was just installed), or an editor the studio can't identify. That last case — the one the studio cannot resolve — is now also warned about when the DTH Export panel opens, before the Daz and Houdini legs spend their minutes, instead of surfacing as an import that silently never runs.
