---
'@dth/web': minor
'@dth/desktop': minor
'@dth/rom': minor
'@dth/ui': minor
---

feat(web,desktop,rom): **DTH Export** in the character editor header — hand the ROM+export runs to the DTH Exporter Plugin. The button opens a scene-picker dialog listing every linked Daz scene as a checkable card; scenes whose `.duf` or definition inputs changed since their last handoff come pre-checked (first run: all), and a per-row wand solos one scene. Confirming writes a `dth_exporter_jobs.csv` (one ROM-script row per scene) into the `Scripts/DTH-Character-Studio` root and starts a scene-less Daz Studio when it isn't running (new `launch_daz_studio` command); the plugin polls for the file (startup + regularly — a running Daz accepts new batches in place), deletes it as the transfer ack, and works through the rows (contract: `docs/exporter-plugin-job-file.md`). While the job file is still waiting for Daz, the button shows **Abort** — clicking deletes the file (and re-flags the aborted scenes as changed) and returns to DTH Export.

Runtime v38: generated scripts understand the **`bulk-export` script argument** the plugin passes on job runs — with it, the ROM script always exports (export block embedded even with "Run the export with the ROM script" off, hair pass past a disabled "Export hair assets"); a manual run keeps honoring the toggles. Also: InfoPopups now work inside modal dialogs — opening a Modal/SidePanel closes any open popup, and the popup layer moved above the dialogs.
