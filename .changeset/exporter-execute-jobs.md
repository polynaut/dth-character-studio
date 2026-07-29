---
'@dth/web': minor
'@dth/desktop': minor
---

feat(web,desktop): **Execute / Execute all** in the character editor header — hand the ROM+export runs to the DTH Exporter Plugin. The studio writes a `dth_exporter_jobs.csv` (scene path + script path per row) into the `Scripts/DTH-Character-Studio` root and starts a scene-less Daz Studio (new `launch_daz_studio` command); the plugin picks the file up on startup, deletes it as the transfer ack, and works through the rows (contract: `docs/exporter-plugin-job-file.md`). **Execute** queues the selected scene unconditionally; **Execute all** (needs an export directory) queues only the linked scenes whose `.duf` or definition inputs changed since their last handoff — first run queues all, Ctrl+click forces all.
