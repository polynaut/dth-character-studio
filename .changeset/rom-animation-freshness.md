---
'@dth/rom': patch
'@dth/web': patch
---

fix: a scene card's open menu now offers "Open ROM Animation" as soon as the animation is built. Its freshness came from the EXPORT handoff stamps, which a ROM-animation build never writes — so a freshly built animation still read stale forever (and a character that never exported read stale from the start), only looking right after a page reload. It is derived from the files themselves now: the saved `.duf` is current when it is newer than both the source scene and the character's generated ROM script, so a window focus always re-reads the truth.

Also: the ROM-scene save logged "Could not save the ROM scene" on every successful Daz Studio 6 save — `DzScene::saveScene` returns a `DzError` (0 = success), not a bool. Runtime v45; Refresh assets regenerates the affected scripts. And the bundled Runner is v1.1.4: a scene handed to a running Daz is marked unmodified after loading, so closing it no longer asks to save changes nobody made.
