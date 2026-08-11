---
# patch: layout/copy tidy in the Daz Studio plugins panel — no behavior change
# to scanning or installing.
'@dth/web': patch
---

**The Daz Studio plugins panel anchors each detection under its folder — and two standing hint lines retire.**

Each found Exporter DLL is now listed directly **under the release-folder field it came from**, instead of in one block below the whole list — and the hint drops the folder path, which only echoed the field above it. When one folder holds a subfolder per generation, the subfolder still shows (`· Daz Studio 4`), since that's what tells the two builds apart. The standing *"Runner plugin — ships with this app (…)"* line is gone too: the **Runner plugin** table header says it on hover instead.

Two hint lines that only explained the obvious are removed outright: *"Everything up to date — Reinstall copies it all again."* beside the plugin install buttons (the button already reads **Reinstall all** and the table above is green — the pending counter stays, it's the actionable state), and the *"New folders can't be added while a Houdini installation is activated…"* paragraph at the bottom of Setup DTH Release (the button simply disappears; the guide documents the rule).
