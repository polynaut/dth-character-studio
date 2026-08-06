---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

Utils: refuse a material transfer whose bakers would lose their UV source, and close the dialog when a run succeeds

Unticking **UV channels** while a material whose bakers read `uv_geoshell` is
selected produced a copy that cannot work — those bakers land pointing at a UV
name nothing at the target creates. Transfer is now disabled for that
combination, with the reason shown beside the checkbox that causes it.

The confirm dialog also closes itself after a successful real run; a failure
keeps it open with its error, and a run that succeeded with warnings says so in
the toast.
