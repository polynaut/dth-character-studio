---
'@dth/web': patch
---

fix(web): the Replace-primary dialog drops the "Delete the old primary scene file" toggle — replacing always deletes the outgoing in-folder copy (that's what replacing means); a linked-in-place original is still only unlinked, never touched.
