---
"@dth/web": minor
---

"Export too" shows what Houdini is doing **during** an export node's minutes-long run, not just node counts: 456.py now captures the HDA's own output (stdout/stderr and status-bar messages) while `do_export` works and streams it into the polled result file — the header's Houdini chip names the scene and shows the last line live (verified on a real run: "DazToHue: export started"), counts the node being worked on (1/1 instead of "0 done"), and its tooltip carries the recent tail plus the `.dth` import the node works through. Each node's report keeps a capped log. Nothing captured degrades to the elapsed-time display as before.
