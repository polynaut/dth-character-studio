---
"@dth/web": minor
---

The "Export too" Houdini leg now runs **completely headless**: hython loads the project and works the batch in the background — no Houdini window, no startup/viewport wait, and the full console (C++ cook chatter included) streams into a per-run `.dth_houdini_console.log` beside the job/result files (cleared with them; kept when a run dies without reporting). "Open only" still opens the visible GUI. Liveness comes from the launched process itself, so an unrelated hython (background scans) can't masquerade as the run.

It also shows what Houdini is doing **during** an export node's minutes-long run, not just node counts: 456.py now captures the HDA's own output (stdout/stderr and status-bar messages) while `do_export` works and streams it into the polled result file — the header's Houdini chip names the scene and shows the last line live (verified on a real run: "DazToHue: export started"), counts the node being worked on (1/1 instead of "0 done"), and its tooltip carries the recent tail plus the `.dth` import the node works through. Each node's report keeps a capped log. Nothing captured degrades to the elapsed-time display as before.
