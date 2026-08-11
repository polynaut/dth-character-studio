---
# patch: two fixes from one live run — no new capability.
'@dth/web': patch
'@dth/ui': patch
---

**The Houdini export leg opens visibly again, and a finished run's tooltip lets go of the screen.**

- **Houdini ran the whole export invisibly** — window never painted, exports delivered, session closed itself (measured 2026-08-11: a four-minute run with nothing on screen). The deferral that was supposed to wait for the window (`hdefereval.executeDeferred` + a 10 s timer) is not a paint guarantee: Houdini pumps the event loop during startup, so on a slow first scene load the timer fired **before the main window painted**, the batch seized the UI thread for the whole run, and `closeWhenDone` closed the never-shown window. 456.py now polls `hou.qt.mainWindow().isVisible()` and only starts the breather once the window is actually up (bounded at 2 minutes, so an odd session still exports).
- **The DTH Export button's tooltip stayed on screen after a run finished.** The tooltip hides on mouse-leave — but a button that **unmounts under a stationary cursor** (exactly what a finishing progress state does) never emits one, leaving the tooltip pinned to a detached element forever. The tooltip host now watches for its anchor leaving the DOM and hides with it. App-wide fix: every state-swapped control gets it, not just this button.
