---
'@dth/ui': patch
'@dth/web': patch
'@dth/desktop': patch
---

Tooltips get out of the way. Opening a dialog or a side panel now closes any
tooltip that is showing — and cancels one whose hover delay is still counting
down, so it can't appear a moment later on top of the panel you just opened.
Tooltips float above every other layer, so one left over from the button you
clicked used to hang over the dialog it opened.

The same applies whenever the window hands focus to something else: launching
Daz Studio, Unreal or Houdini, revealing a path in Explorer, opening a link — or
just alt-tabbing away. The pointer never moves in those cases, so nothing told
the tooltip to go, and it stayed painted over the app while the other tool was
in front.
