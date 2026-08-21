---
'@dth/web': patch
---

A Houdini project that failed no longer ticks itself off. The run's task list
could only read a failure out of the per-network memo — so the commonest `.hip`
there is, one holding a single DazToHue network, rendered its row positionally:
"the queue has passed it" was the whole verdict, and a failed export came out
struck through and green beside the projects that worked. The same held for a
project that could not START, whose scan-named rows never had a run behind them
at all.

Both positional paths now take the leg's own verdict — the same run-report entry
whose count already decides that the row is finished, so the two cannot disagree.
Where the memo knows which network failed, it still wins: one red row among the
ones that worked, not a project painted red.
