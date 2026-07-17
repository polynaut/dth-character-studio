---
'@dth/web': patch
---

The character editor's Discard/Save buttons keep their large "at the top" size on pages too short to scroll (e.g. the Notes tab) — the same inactive-scroll-timeline quirk as the Back-link fix: with no scrollable overflow the shrink animation yields no values, so the buttons fell to their collapsed default size while the rest of the header showed its expanded state.
