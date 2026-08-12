---
'@dth/web': minor
---

Reloading the app while Houdini is exporting no longer loses the run. The Daz half already survived a reload; the Houdini half didn't — and because that leg runs headless there was no window to notice: hython finished the export, the studio never reported it, and any project queued behind it silently never started at all. Each Houdini run now records its plan beside its own job file — the project being exported, the ones still waiting, the scene scope and the report so far — and the character's editor picks the run back up when it opens. You get the live log and progress back, the remaining projects still run, and the one end-of-everything report still names the legs that finished while the window was away.
