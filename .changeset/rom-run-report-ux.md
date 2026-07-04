---
'@dth/web': patch
---

**Run-report UX polish.** When the last ROM run had problems and its report is scrolled out of view, a compact "Errors in the last ROM run" mini-alert appears beside the path chip in the sticky character header; clicking it scrolls the page back to the top where the full report is (it's hidden at the top, where the report is already visible). In the report, each failed morph is now **clickable** — it opens the ROM section that holds that frame and scrolls the (red-marked) row into view, so you can go straight from the error to the field to fix.
