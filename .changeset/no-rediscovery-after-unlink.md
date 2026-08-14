---
'@dth/web': patch
---

Unlinking or deleting a Daz scene no longer re-offers it as a "new file"

Removing a scene made it a discovery by definition — unlinked, still in the
folder — so the banner announced it the moment the unlink saved. For a DELETE it
was worse: the unlink persists before the file is removed (deliberately, so a
failed save never points the character at deleted files), and persisting is what
re-runs the folder scan, so the scan raced the delete and left a banner
advertising a file that no longer existed until the next window focus. Removal
now answers for the file in both cases.
