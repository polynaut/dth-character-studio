---
"@dth/web": minor
"@dth/desktop": minor
"@dth/rom": minor
---

The DTH Export header now shows the whole pipeline live. A task-card column (each selected Daz scene, then each Houdini project, in run order) sits beside a monospace tail-mode log window above the header buttons: the active task wears its kind's solid color, waiting ones sit grayish, and a finished task drops away bottom-right while the rest slide up. The log window streams both legs — the new per-scene Daz progress and the Houdini HDA's captured output.

Daz-side progress comes from the new Runner v1.2.0 contract: the job file carries a `progressLogPath` + per-row `steps`, the Runner logs `[<percent>] <message>` lines for the steps it owns (scene open, terminal done/failed) and the generated scripts (runtime v71) append the interior steps — ROM generated / character exported / CSV delivered / hair exported — on the same per-scene percent scale (5 steps with a ROM build, 4 export-only, 2 rom-only). Old Runners keep working (they ignore the new fields; the display then shows row counts as before).

The "Export too" Houdini leg now runs **completely headless**: hython loads the project and works the batch in the background — no Houdini window, no startup/viewport wait, and the full console (C++ cook chatter included) streams into `.dth_houdini_console.log` beside the job/result files (one file per character, overwritten each run and kept afterwards as the diagnosis channel — a run that matches no export nodes now logs exactly what it wanted vs. found). The job is handed over by running the studio's script directly, never via `HOUDINI_SCRIPT_PATH` — Houdini runs scripts found there against the startup empty scene too, which consumed the job before the project had loaded. "Open only" still opens the visible GUI. Liveness comes from the launched process itself, so an unrelated hython (background scans) can't masquerade as the run.

It also shows what Houdini is doing **during** an export node's minutes-long run, not just node counts: 456.py now captures the HDA's own output (stdout/stderr and status-bar messages) while `do_export` works and streams it into the polled result file — the header's log window names the scene and shows the lines live (verified on a real run: the HDA emits a 9-phase progress vocabulary), and each node's report keeps a capped log. Nothing captured degrades to the elapsed-time display as before.

Also restored: the ~1 s settle pauses at the Daz automation seams (runtime v70 — the Runner-driven bulk script waits after the scene load before the first scripted work, and every export waits after the ROM build before the exporter starts), which had been orphaned by an earlier squash-merge.
