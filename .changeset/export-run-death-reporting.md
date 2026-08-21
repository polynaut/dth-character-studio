---
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
  cooking the corpse into a green checkmark.
- **Honest Houdini death reporting**: a headless export that exits without a
  word is reported as "Houdini exited during \<its last step\>" instead of
  quoting a stale load-time warning as the cause; the hython exit code —
  previously discarded by the fire-and-forget spawn — rides along (hex spelling
  included for Windows crash statuses).
