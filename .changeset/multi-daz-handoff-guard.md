---
# bump: patch is deliberate — the new command + error class only power a
# guard that REFUSES a broken state (two Dazs racing one job file); the app
# gains no capability it did not have.
"@dth/web": patch
"@dth/desktop": patch
---

Refuse DTH job handoffs while more than one Daz Studio is open. Two installations open side by side (a DS4 next to a DS6) both host a Runner watching the same job file, so batches ran in whichever Daz noticed first and their progress bookkeeping could clobber each other. Every batch handoff (DTH Export, ROM build, project scan, scene scan) now counts the running Daz processes first — each install is single-instance, so two processes means two installations — and shows a dialog asking to close all but one.
