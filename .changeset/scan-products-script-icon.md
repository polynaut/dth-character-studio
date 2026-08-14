---
'@dth/rom': patch
'@dth/web': patch
---

The per-character product-scan script gets a Content Library tile.

`Scan_Products_<Name>.dsa` was the last generated script installed without
artwork, so it showed up in Daz's Content Library as a broken-image placeholder
next to the ROM and Export scripts that have had tiles since v0.68. It now
carries its own, in both sizes Daz reads by name (the 91×91 tile and the 256×256
hover preview).

Turning Daz Products off retires the tiles along with the script, rather than
leaving artwork behind pointing at a script that no longer exists.

The scripts themselves are unchanged — but artwork only lands when a character
regenerates, so this ships as a runtime-version bump: existing characters pick
the tile up on their next save, or all at once via **Tools → Refresh assets**.
