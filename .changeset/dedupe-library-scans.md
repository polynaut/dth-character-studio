---
'@dth/web': patch
---

Saving a character is faster on projects with many characters (and much faster over a "Refresh assets" sweep or on a network-share project). Generating a character's files now resolves where it lives on disk once and reuses that, instead of re-scanning the whole character library three times per save.
