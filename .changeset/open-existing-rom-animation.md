---
'@dth/web': minor
---

**A saved ROM animation can be opened whenever it exists — stale or not.**

A scene card's open menu offered **Open ROM Animation** only while the saved
`rom-animations/<scene>_ROM.duf` was *current*, and swapped it for **Open and
Generate ROM Animation** the moment it wasn't. That threshold is far lower than
it sounds: freshness is dated against the generated ROM script, which every
character save rewrites, so editing anything at all makes every saved animation
of that character stale. A primary scene whose ROM had been built and exported
was therefore offered nothing but a rebuild — a Daz run of many minutes — with
no way to open the file sitting right there.

Both entries now stand on their own. The file is on disk, so it opens; when it
predates the current definition the row says so (*From an earlier run — the
scene or the definition changed since*) and opens it anyway, because stale is
not wrong, it is "not from what the character says now" — the user's call. The
rebuild sits under it whenever it is worth offering: no saved animation, a stale
one, or Ctrl held to force a fresh build of a current one.

**Open Original** is now **Open scene** — it opens the scene, and "original"
only meant anything next to the entry it used to replace.

While a rebuild is running, the open entry is disabled rather than merely the
rebuild: the build overwrites the very file that entry points at, and opening it
would hand the running Daz a scene switch mid-build. It comes back by itself
when the freshly built animation opens.
