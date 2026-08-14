---
'@dth/ui': patch
---

**InfoPopup: a hover peek that was still counting down when a dialog opened could land on top of it — and swallow clicks.**

The overlay sweep (`closeAllInfoPopups`, called by `Modal`/`SidePanel` on open) could only ever close popups that were ALREADY open: registration lived in an effect guarded on `open`. A hover peek sits on a 90 ms delay first, so a pointer resting on an "i" when an overlay opened left a timer the sweep could not see. It fired afterwards and painted the popup at `z-[60]`, over the z-50 dialog.

Unlike a tooltip — which is `pointer-events-none` and can never take a click — the popup is interactive, so it did not merely look wrong: it intercepted clicks aimed at whatever sat beneath it.

Every mounted popup now registers with the sweep, and the sweep marks a pending hover open as stale so it becomes a no-op. Re-armed by the next `mouseenter` or a deliberate click on the trigger, so it only ever eats the one stale peek — and only a peek: opening the "i" with the keyboard is never refused. `TooltipHost` has always guarded the same case on its own layer ("cancel one that is counting down to appear"); this is that rule for the other one.

Pinned by a fail-then-pass regression test.
