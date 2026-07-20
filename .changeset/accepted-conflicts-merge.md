---
'@dth/web': patch
---

Accepting/clearing dedup conflicts no longer clobbers a settings change made in another window. The write now goes through the same field-level merge as a normal settings save, so it only updates the accepted-conflicts list and re-reads every other field from disk.
