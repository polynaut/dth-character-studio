---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
'@dth/ui': minor
---

DTH Export names the jobs each project will contribute, before the run starts

The panel's Houdini rows now carry one chip per **DazToHue network** the stored
scan says that project writes, and the Unreal rows one chip per **character**
landing in that project. Those are exactly the rows the run's task list is built
from — one per network on the Houdini leg, one per export set per project on the
Unreal leg — so the queue Start produces is readable before pressing it.

Both stay silent when the studio cannot say: an unscanned Houdini project names
nothing rather than claiming it writes none, and a set the Unreal project has
never held is left off, because the send is re-import only and the run would
drop it too.
