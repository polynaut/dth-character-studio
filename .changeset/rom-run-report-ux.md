---
'@dth/web': patch
---

**Run-report UX polish.** When the last ROM run had problems, a top-centered "Errors in the last ROM run" mini-alert fades into the sticky character header as you scroll (hidden at the top, where the full report banner is already visible); clicking it scrolls the page back up to the report. In the report, each failed morph is now **clickable** — it opens the ROM section that holds that frame and scrolls the (red-marked) row into view, so you can go straight from the error to the field to fix.
