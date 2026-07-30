---
'@dth/web': patch
---

fix(web): DTH Export no longer strands the batch when Daz Studio is still shutting down. Pressing Start while the just-closed Daz process lingers used to hand the jobs to an instance that would never pick them up (and a fresh launch would die against the dying single instance) — nothing happened. The studio now watches for the Runner's claim; when it doesn't come, a "Waiting for Daz Studio to close…" dialog takes over and starts Daz automatically the moment the process is really gone — the queued batch begins by itself. The batch stays abortable throughout.
