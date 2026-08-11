---
'@dth/desktop': minor
'@dth/web': minor
---

Daz Studio now starts minimized for work nobody is watching.

Every unattended run the studio hands to the Runner — a **DTH Export** batch, a
**project scan**, an **Import from Daz scene** scan, and the restart of a batch
that was still waiting when Daz closed — used to open Daz Studio full size, in
front of whatever you were doing, for a job that takes minutes and needs no
input. Those launches now bring Daz up **minimized**: it sits in the taskbar and
works, and the studio's own progress button is where you watch the run.

What did not change:

- **Opening a scene from its card** still opens Daz normally and pulls it to the
  front — you asked to see the scene.
- **Open and Generate ROM Animation** still comes up visible too. It opens a
  scene you picked and leaves the built ROM on its timeline to look at.
- **A Daz you already have open** is never touched. The studio only minimizes an
  instance it started itself; an instance of your own keeps whatever position and
  size you left it at, and simply picks the batch up.

Windows only, and best-effort by design: if the window never appears the launch
still stands on its own, and nothing waits on the minimize.
