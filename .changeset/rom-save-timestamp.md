---
'@dth/rom': patch
---

fix: "ROM scene saved" now means it actually was

The previous fix judged the ROM-animation save by whether the file exists. That reads correctly the first time and lies afterwards: the file is overwritten on every run, so from the second run on it is already there — and a failed save would report success while the **previous run's ROM** sat on disk, ready to be exported as though it were fresh.

The file's timestamp has to move now. A file that wasn't there before is proof on its own, and if no timestamp can be read at all the check falls back to existence rather than crying wolf. When the save really does fail, the message says what's actually on disk: the file is unchanged and still holds the previous run's ROM.

Runtime v50 — Refresh assets regenerates the scripts.
