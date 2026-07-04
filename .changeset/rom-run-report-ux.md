---
'@dth/web': patch
---

**Run-report UX polish.** When the last ROM run had problems and you're scrolled down the character page, a compact "Errors in the last ROM run — click to see details" hint now rides the sticky header, animating in as the header collapses (mirroring the subtitle, inverted) and back out at the top; clicking it jumps to the report. In the report, each failed morph is now **clickable** — it opens the ROM section that holds that frame and scrolls the (red-marked) row into view, so you can go straight from the error to the field to fix.
