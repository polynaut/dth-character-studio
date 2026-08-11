---
"@dth/web": minor
---

"Export too" shows what Houdini is doing **during** an export node's minutes-long run, not just node counts: 456.py now captures the HDA's own output (stdout/stderr and status-bar messages) while `do_export` works and streams it into the polled result file — the header's Houdini chip shows the last line live, its tooltip the recent tail, and each node's report keeps a capped log. Nothing captured (an HDA that emits nothing) degrades to the elapsed-time display as before.
