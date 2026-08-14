---
'@dth/web': patch
---

The DTH Export finish toast stops contradicting itself

A run that exported one scene in 45s was titled exactly that, above a
description of an earlier run's two scenes in 7m 50s and 25m 32s — the same Daz
warning printed twice, a green tick over an Unreal failure, and every line
welded into one paragraph.

Five paths end a run and all write the same sticky toast. Sonner merges an
update over the existing one, so a path that passed no description inherited the
previous report's body; every path now passes it explicitly. The per-leg lines
render as lines again (the newlines were collapsing), and the Daz problems are
deduplicated, stripped of their "Continue anyway?" — a question the script
answered minutes before anyone reads it — and capped, with the tail counted.
