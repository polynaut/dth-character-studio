---
'@dth/web': patch
---

Fix: the Houdini Utils drawer's "backups removed" confirmation now disappears on its own after a few seconds. Every other toast the drawer raises reports the result of a run that took hython tens of seconds, so it stays until dismissed — but a clean backup sweep on drawer close is housekeeping the user just asked for and watched happen, and leaving it pinned meant hand-dismissing a message with nothing to act on. The partial form ("2 of 3 backups removed — the rest are in use and stay") still sticks, because it names copies still sitting on disk and the drawer closing behind it makes that toast their only mention.
