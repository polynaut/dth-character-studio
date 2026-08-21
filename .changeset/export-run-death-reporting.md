---
# bump: patch is deliberate — nothing here is a new capability. Both signals
# the gate caught (`verifyDazExportsLanded`, `houdini_job_exit_code`) are
# internal WITNESSES: they exist only so an existing feature stops reporting a
# success it never earned. No new page, no new button, nothing the user can do
# that they could not do before — a run that used to show a green checkmark
# now shows the failure it was hiding. That is a fix, not an addition.
'@dth/web': patch
'@dth/desktop': patch
'@dth/rom': patch
'@dth/ui': patch
---

A Daz or Houdini export leg that dies silently can no longer report as a success.

- **Export-landed guard**: after the Daz batch finishes, each scene's export
  set is judged from the disk before the Houdini leg consumes it — a 0-byte
  `.dth`, a missing manifest, or the export sweep's `.dthprev` backups still
  standing (the signature of a script Daz's engine killed mid-export) now fails
  that scene loudly and drops it from the Houdini continuation, instead of
  cooking the corpse into a green checkmark. A scene that failed OUT LOUD —
  a failed Runner row, or a script that reported its own failure — now drops
  out of that continuation as well: its export folder looks landed only
  because the failure path put the previous export back, and handing it on
  imported last week's character under this run's checkmark.
- **The export backup sweep finishes its job again** (runtime v100): the
  `.dthprev` step that restores the previous export on failure and purges it on
  success was listing through a directory handle read *before* its own renames,
  so it did neither — a successful export kept every backup it made, and a
  failed one never got the previous set back. Refresh assets regenerates the
  installed scripts. Because a script from the previous runtime still leaves
  its backups behind, leftover backups are now reported as a **warning** rather
  than treated as proof the export failed; the `.dth` decides.
- **Honest Houdini death reporting**: a headless export that exits without a
  word is reported as "Houdini exited during \<its last step\>" instead of
  quoting a stale load-time warning as the cause; the hython exit code —
  previously discarded by the fire-and-forget spawn — rides along (hex spelling
  included for Windows crash statuses).
