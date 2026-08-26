---
'@dth/web': minor
'@dth/desktop': minor
---

Make paths portable now FIXES paths under a foreign Daz library root — the
missing baker textures and "cannot be made portable" references a moved
library (or a `.hip` from another machine) leaves behind. When a path's
library-relative tail exists under your configured library, the repath
repoints it there as `$DAZ3D_LIB/…` (portable straight away); the General tab
counts these as fixable instead of stuck, the card badge says which missing
textures the button repairs, and the report names each old → new pair. Only a
path whose target file actually exists is ever rewritten — everything else
stays reported, exactly as before.
