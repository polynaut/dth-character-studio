---
'@dth/web': patch
---

The header's DTH Export button now stays in its **Working** state through the
run's Unreal leg. Since the run learned to wait for the editor's answer, the
task panel stayed up for the whole import — but the button had no face for
that leg, so it dropped back to the idle "DTH Export" the moment the export
legs were done, right under a panel saying the import was half way through.
It now shows the Unreal mark with the leg's status and its own clock, and is
deliberately inert: the import runs inside the Unreal editor, so there is
nothing a click here could stop.

The import's status line also lost its tail: "…is importing — the editor
freezes while the DazToHue pipeline runs" overflowed the status bar and now
reads just "…is importing".
