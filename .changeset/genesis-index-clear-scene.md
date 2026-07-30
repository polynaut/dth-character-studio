---
'@dth/web': patch
'@dth/rom': patch
---

fix(web,rom): **`Build_Genesis_Index` leaves an empty scene behind.** It already cleared between generations; now it clears once more after the last one is scanned, so a build no longer ends with the final generation's stock figures still loaded. Only the build path clears — scanning the open scene is still non-destructive, which is what makes it safe for indexing third-party geografts, add-ons and fitted clothing. Runtime v41: Refresh assets reinstalls the updated scanner.
