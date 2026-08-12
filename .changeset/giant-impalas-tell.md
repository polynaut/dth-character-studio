---
'@dth/web': patch
---

The DTH Export progress meters carry no caption anymore. The overall bar used to
label itself *"Scenes 0/2"*, which the numbered task-card column beside it
already says — and the caption indented that track, leaving the two bars starting
at different left edges. Both are now a track and a percent: the cards say what
is running, the log window's newest line says how it is going, and the meters say
how far.

Also documents this release's Houdini work in the guide, which had gone out of
step with it: the export leg is headless now (the guide still said Houdini
"opens visibly so you can watch it work" and quoted button labels that no longer
exist), the header shows the run live, **Ctrl** is what gets you out of one, a
reload no longer loses either leg, and Generate project names the Daz scene it is
generating for.
