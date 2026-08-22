---
'@dth/web': patch
---

A Houdini scan that lands after the DTH Export dialog opened now reaches it. The
dialog read the stored scan ONCE when it mounted, so a project scanned later —
by the background sweep, or by a manual **Rescan** — stayed invisible to it:
picking a scene auto-selected no Houdini project, the **Networks** and
**Characters** chips never appeared, and the run's task list showed a single row
for a `.hip` that exports two networks. Reloading the app was the only way out.

It surfaced right after the scan-version bump that shipped with the two-network
scan fix, because that invalidates every stored scan at once and makes the gap
between opening the dialog and the sweep landing as wide as it gets. The scans
themselves were correct the whole time.

Both readers now re-read: the dialog joins the sweep already in flight when it
finds fewer scanned projects than linked ones, and the task list's copy refreshes
every time the dialog opens — the moment that always precedes a run.
