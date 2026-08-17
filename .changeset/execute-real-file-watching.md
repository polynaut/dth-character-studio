---
'@dth/web': minor
'@dth/desktop': minor
---

The DTH Export run is now followed by real file watching instead of polling.

The studio watches the Daz job-file pair (the Daz library's studio scripts
folder) and the verbose progress log (app-data) with a native file watcher —
the fs plugin's notify backend (`ReadDirectoryChangesW` on Windows, FSEvents
on macOS). The Runner's pickup rename, every per-row rewrite and the final
progress-100 write now reach the export button, the pipeline panel and the
Tools → Scan project panel the moment they land, instead of on the next
2.5-second poll tick.

The interval survives as a slow safety-net heartbeat, deliberately: change
notification over SMB/NAS shares is best-effort, watching isn't available in
a plain browser, and a Daz that dies mid-run announces itself through no file
event. The Houdini and Unreal legs keep their full-speed poll — their files
aren't part of this watch (yet).

Every refresh trigger (watch event, heartbeat, window focus) now funnels
through one coalesced call per panel, so a burst of events can never race two
destructive finished-run reads over the same job file.

Paired with DTH Character Studio Runner v1.3.0, which watches for the handoff
the same way (`QFileSystemWatcher` + fallback timer) — together they make the
studio → Daz pickup and the Daz → studio results near-instant. Older Runners
keep working on their poll; the job-file contract is unchanged.
