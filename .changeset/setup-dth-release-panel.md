---
# patch: layout + copy polish of an existing Settings panel, no behaviour change.
'@dth/web': patch
---

**The Setup DTH Release panel reads as install targets now.** The two halves of a release install — Daz content into the library, Houdini assets into a documents folder — each get an icon-tile row under one "Ready to install DTH x.y" lead-in, so the panel reads as "one release, these destinations" instead of a run of look-alike fields and buttons. "Add another Houdini folder" became the dashed add-row it acts like, and extra folders join as further target rows.

**Derived destinations name their true source.** The "Installs into … from the Daz installation above" sentence was hardcoded — even under the Houdini documents folder (derived from the *Houdini* installation) and under Generate Houdini Projects' hython path, which is a tool source, not an install destination. Each now names the section it actually derives from, an empty Houdini documents folder gets the real fix ("start this Houdini once"), and the hython line says "Uses" instead of "Installs into" — including when its path is empty, where "start this Houdini once" would have been the wrong advice (a launch creates the documents folder, never the installation folder).
