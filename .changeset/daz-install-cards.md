---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

**Settings → General now finds your Daz installation instead of asking for it.**
Every Daz Studio the DAZ Install Manager has installed appears as a card at the
top of the tab. Click one and three paths are derived from it and saved
immediately — **My DAZ 3D Library**, the **Daz Studio install folder** and the
**DIM manifests folder** — then shown read-only underneath, because a derived
path you can edit is one that can quietly disagree with what produced it.

DIM records all of this in `%APPDATA%\DAZ 3D`, at a fixed location whatever
folder DIM itself lives in, so nothing is searched for and nothing is guessed.
The old manifests detection walked `<A..Z>:/DAZ 3D/Install Manager/ManifestFiles`
and took the first hit; it survives only as the last of three fallbacks.

With both Daz Studio 4 and 6 installed, both get a card and the newest is marked
*recommended* — but nothing is activated until you click, so a first run still
starts with empty paths and adopts them the moment you choose. Only the install
folder follows the card; the library and product database belong to DIM, not to
one Studio version. **Set the paths manually** hands the three fields back with
their current values, for a machine DIM doesn't describe — and a machine with no
DIM at all keeps the editable fields it always had.
