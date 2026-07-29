---
'@dth/web': minor
'@dth/desktop': minor
---

feat(web,desktop): **DTH Export** in the character editor header — hand the ROM+export runs to the DTH Exporter Plugin. The button opens a scene-picker dialog listing every linked Daz scene as a checkable card; scenes whose `.duf` or definition inputs changed since their last handoff come pre-checked (first run: all), and a per-row wand solos one scene. Confirming writes a `dth_exporter_jobs.csv` (scene path + script path per row) into the `Scripts/DTH-Character-Studio` root and starts a scene-less Daz Studio (new `launch_daz_studio` command); the plugin picks the file up on startup, deletes it as the transfer ack, and works through the rows (contract: `docs/exporter-plugin-job-file.md`). While the job file is still waiting for Daz, the button shows **Abort** — clicking deletes the file (and re-flags the aborted scenes as changed) and returns to DTH Export.
