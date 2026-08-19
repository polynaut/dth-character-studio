---
'@dth/web': patch
---

The "just re-import into Unreal" run no longer hides behind the Daz mode dropdown. In DTH Export, leaving every Daz scene unticked with **Skip Houdini — use last exports** and a ticked Unreal project now starts the send under **any** Daz mode — Start used to hold on "Select at least one Daz scene" for a run that needs none, unless you also switched the Daz mode to "Skip Daz". The selection describes the run: no scenes and no Houdini leaves only the re-import, and the Runner-plugin gate (a Daz concern) no longer blocks or badges it.
