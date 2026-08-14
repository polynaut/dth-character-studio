---
'@dth/rom': patch
'@dth/web': patch
---

DTH Export can no longer report a run that produced nothing as a success.

The Runner's contract ends at "the script I started returned", so a row whose
generated script refused the scene, bailed for want of a runtime, or failed
mid-ROM came back `done` — indistinguishable from one that exported. The finish
report believed those rows, and a run that wrote no files toasted "1 scene
exported" while the character page's own run report showed the failure right
underneath it. It now reads the scripts' own channel (the ROM run log,
restricted to entries written since the handoff and de-duplicated against rows
the Runner already failed), counts those scenes as failures, names them in the
report, and holds back the Houdini/Unreal continuation when nothing survived.

Three fixes on the Daz side of the same story:

- A catastrophic-failure log always tags its scene now. The old fallback shape
  had no `scene` field and fired whenever there was no previous log to merge —
  the common case, since the studio deletes the transport log as it ingests one
  — so a failure could reach the report attributed to no scene at all.
- The "runtime could not be loaded" report probes for the runtime file and says
  what it found: missing gets the reinstall advice, present gets "Daz failed to
  load it — run the export again". A failed `include()` logs nothing in Daz, so
  this is the only evidence such a run leaves behind, and the blanket reinstall
  advice sent users to rebuild an install that was never broken.
- Every string the generated scripts write or display is ASCII. Daz's file
  writer cannot carry anything else: the arrow in "Tools → Refresh assets"
  reached the run report as "Tools ? Refresh assets", and em dashes printed to
  the Daz log arrived as mojibake.
