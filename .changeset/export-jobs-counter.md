---
'@dth/web': patch
---

fix(web): the export button reads **"Exporting 1/2"** (processed scenes / total) instead of the percent, which only ever moved in whole-row jumps — and the whole app carries the OS **progress cursor** while a batch runs. The Runner (v1.1.1) writes a `jobsDone` counter into the job file on every rewrite; older Runners work identically (the count derives from the row statuses).
