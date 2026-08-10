---
# minor: the stranded-job-file clear is a new action in Settings (and a new
# pair of api exports); the install-aware probe half of it is a fix.
'@dth/web': minor
'@dth/desktop': minor
---

**Fixed: with "Export only" set, DTH Export started nothing at all.**

Daz Studio 4 and Daz Studio 6 both run an executable called `DAZStudio.exe`, and the studio's "is Daz running?" check went by that name. So with the newer Studio open and **Export only** pointing at the older one, the export concluded Daz was already running, never started the installation the batch was actually for, and left the job file waiting for a Daz that never came — silently: no window, no error. The same blindness let a running Daz Studio 6 hijack a launch aimed at Daz Studio 4, and kept the "waiting for Daz Studio to close" dialog spinning forever over an installation that was not the one closing.

Both checks now identify an installation by the running executable's path, not its name: the export batch asks about the installation *it* runs in, everything else (opening a scene, the scene-open bridge) still asks about any Daz, and a launch starts the installation it was given rather than whatever happens to be open.

**New: clear a stuck exporter job file from Settings → App Data.**

The handoff file that caused the above blocks every later export *and* scan with "a batch is waiting for Daz Studio", and until now nothing could remove it once no character owned it anymore. **Storage & housekeeping** now shows which job file is there (waiting for Daz, or claimed by the Runner), how many jobs it holds and how old it is, warns when Daz may still be working through it, and deletes it on confirmation.
