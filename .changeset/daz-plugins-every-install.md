---
# minor: a new settings field (the folder LIST), a rebuilt panel, and a new rule
# about where plugins go — behaviour that did not exist before.
'@dth/web': minor
---

**Daz plugins now install into every Daz Studio on the machine.**

Both plugins the studio puts inside Daz — the **DTH Exporter** (mrpdean's) and the **DTH Character Studio Runner** (bundled) — ship one binary per Studio generation. The old panels asked for one Exporter release folder and installed into one Daz, which on a machine with Daz Studio 4 *and* 6 could only ever describe half the setup: it would happily offer to copy a Daz Studio 4 build into a Daz Studio 6 install, which cannot even load it.

Settings → General now has one **Daz Studio plugins** section instead of two. Add as many Exporter release folders as you like — or just the folder holding `Daz Studio 4` and `Daz Studio 6` subfolders, which is how the plugin is published; both are scanned, one level deep. Which Studio a build is for is read from the DLL's own name (Daz Studio 6 only loads `dsp_*.dll`, so the name is the contract, not a guess), with the folder name kept as a cross-check the panel flags when the two disagree. Underneath, every Daz Studio detected on the machine is listed with what it has now and what it would get, and **Install / update all** copies each build into the installations it was built for — one labelled line per copy in the report, so one Daz needing admin rights while another doesn't reads as exactly that. An installation with no matching build is named, never served the wrong binary.

**"Export only" can point at Daz Studio 4 again.** It was blocked there because the Studio 4 exporter had no scripted export — a batch would run every scene and export nothing. mrpdean shipped scripted export in the Daz Studio 4 plugin with **Exporter 2.0.2.0**, and a DS4 batch was measured writing its files, so the restriction is gone.

The single `dthExporterFolder` setting is superseded by a list and carried over automatically; the Exporter version picker is gone with it — each generation simply installs the newest build found across your folders.
