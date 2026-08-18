---
'@dth/rom': patch
'@dth/web': patch
---

The pre-export sweep is gone (runtime v87): the generated export block no longer clears or moves aside the scene's previous export set before `doExport`. The sweep only existed to work around the DS4 exporter plugin going static when its output files already existed — that is now fixed in the plugin itself, which handles existing files on its own. With the sweep, its move-aside/restore machinery and the .dth-landed gating of CSV delivery and the hair pass are removed too. Requires an exporter plugin build with the existing-files fix on DS4 — older DS4 plugin builds regress to silent static exports there. Save the character (or Tools → Refresh assets) after updating to regenerate the scripts.
