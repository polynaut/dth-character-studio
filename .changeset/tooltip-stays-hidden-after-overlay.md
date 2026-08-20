---
'@dth/web': patch
'@dth/desktop': patch
---

**Closing a dialog or drawer no longer pops the tooltip back up.** Tooltips are swept away when an overlay opens (they render above it), but closing one hands focus back to the control that opened it — and a tooltip on focus shows with no delay, so it reappeared over the app under a mouse that had never moved.

Focus now only shows a tooltip when the focus is the **keyboard's**: tab to an icon-only control and its description still appears immediately, while focus the app moved for you — an overlay closing, a click landing on a button — stays quiet. Hovering is unchanged.
