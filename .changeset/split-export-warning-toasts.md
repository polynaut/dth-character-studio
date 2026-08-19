---
'@dth/web': patch
---

The DTH Export finish report no longer welds warnings into its own (green) toast. The HDA's pre-flight complaints — the dialogs 456.py answers "Continue anyway?" to on your behalf — now arrive as **separate warning toasts**, one per distinct complaint per project, with the already-answered question stripped and per-node repeats collapsed. The summary keeps its own state and only notes "finished with warnings"; a run that worked still reads as a success, and a network's complaint no longer hides under a checkmark asking a question nobody can answer anymore.
