---
'@dth/web': minor
---

Houdini projects: checked in the background, and copyable at last

Linking a Houdini project used to be the only option. Copying one was refused,
because a copied `.hip` arrives broken in ways the studio couldn't see: it
carries the source's `$JOB` and its absolute file references, so it quietly
imports the character it was copied *from*. Now the studio can see all of that —
so copying is offered.

**Projects are scanned in the background.** Opening a character (or changing its
project list) scans its Houdini projects and caches the result, so the Utils
drawer opens on data that is already there instead of starting hython and making
you wait. Only projects inside the character's folder are scanned — one linked
from your own tree is yours, and the studio has no opinion to offer about it. At
most two run at once, and a project whose file hasn't changed since the last look
costs nothing at all.

**A project that needs attention says so on its card**, with the reason in the
tooltip: `$JOB` pointing at another character, import paths that don't resolve,
parameters still blank. Everything it reports has a repair in the Utils drawer.
It stays quiet about a project it hasn't scanned yet — no scan is not a fault.

**Add project can now copy** (or move) the file into the character's Houdini
folder instead of linking it where it lies. Linking stays the default. A name
already in that folder is refused rather than overwritten.

**The PoseAsset CSV path gets its own row in the General tab**, because "not
filled in yet" and "your DazToHue version hasn't got that parameter" are
different answers and only the first is something you can fix.

One thing the checks deliberately do *not* cover: material texture paths. A clean
card means `$JOB`, the DazToHue imports and the blank parameters are fine — not
that every path in the scene resolves.
