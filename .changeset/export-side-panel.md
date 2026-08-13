---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

DTH Export opens in a side panel instead of a centered dialog

The run has three stacked legs — Daz scenes, Houdini projects, Unreal projects
— and the old dialog gave them a 576px column inside 85% of the window height,
so the third one lived below the fold behind a scroll. It is now the same
drawer the Houdini project utils use: full height, the lists at their natural
width, and **Start** pinned to the panel's bottom edge where it can no longer
scroll out of reach.

Nothing about the run itself changed — the same scenes, modes, pre-selection,
Runner gate and Interrupt, in a panel that fits them.
