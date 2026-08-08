---
'@dth/web': patch
'@dth/desktop': patch
---

The studio starts the Daz Studio you activated

Activating a Daz installation in Settings decided where the Exporter plugin was
installed — but not which Daz the studio actually started. Opening a scene was
handed to the shell, so Windows' `.duf` association picked the version (whichever
registered the file type last), and the exporter's launch fell back to a
hardcoded newest-first probe of the standard install folders. On a machine with
both DS4 and DS6 installed, activating DS4 changed neither: DS6 opened, while the
Exporter plugin sat in DS4 and appeared to be missing.

Every launcher now carries the activated installation. Opening a scene starts
`DAZStudio.exe` with it directly, which is association-independent. A Daz that is
already running still wins — DS4 and DS6 are separate single-instance apps, so a
script or scene can only be forwarded to the instance that is up.
