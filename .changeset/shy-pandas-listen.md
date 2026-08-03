---
'@dth/web': patch
---

**The Remove-scene dialog no longer pre-ticks "Delete file on disk" for in-folder scenes.** Deleting is opt-in per removal now: an in-folder scene can be the only copy there is (Add scene's "delete the original" moves it in), the delete is permanent, and unlinking-to-re-add is the documented route around the new replace-primary gate — a pre-ticked delete would destroy exactly the file you mean to keep. A linked-in-place scene still locks the toggle off entirely.
