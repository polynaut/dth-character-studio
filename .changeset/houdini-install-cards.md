---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

**Settings → General now finds your Houdini too**, the same way it finds Daz.
SideFX registers every installed version, so each one gets a card — activating
one fills the **installation folder** and its matching
`houdini<major>.<minor>` **documents folder** together, and saves them.

Filling them together is the point rather than a convenience: the studio runs
`hython` with that documents folder as its preferences directory, and pointed at
another version's it loads the wrong DazToHue assets — or none — so every node
comes back as an unknown type. Pairing by hand is exactly how that goes wrong.

The newest install *with* a documents folder is recommended: one whose folder
doesn't exist yet is still offered, with the missing folder named on its card
(Houdini creates it on first launch — start it once and press **Rescan**).
A `houdini<major>.<minor>` folder no installed version claims is reported below
the cards instead of dropped; it's usually left behind by an uninstall. Extra
Houdini documents folders stay yours to manage — that list exists so an older
Houdini can keep an older DTH release.
