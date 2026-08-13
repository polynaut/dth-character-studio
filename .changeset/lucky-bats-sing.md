---
'@dth/web': patch
'@dth/desktop': patch
---

The DTH Studio Bridge is versioned and tracked, like the Daz Runner. The studio
ships that plugin into your Unreal projects, and a plugin folder keeps whatever
was installed the day it was installed — so it now carries a version the studio
reads back, and a project holding an older copy gets an amber warning on its
card (re-install from the same card, then restart the editor once). A send
refuses outright and names both versions.

The plugin's version is deliberately separate from the job contract: a fix to
the bridge's Python changes nothing the two sides must agree on, and still has
to reach every project holding the old copy.
