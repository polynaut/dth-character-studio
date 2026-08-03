---
'@dth/web': patch
---

**"Export too" never actually ran.** It matched the scenes you ticked against a lowercased lookup table using their raw paths — and every Windows path has a capital in it — so the job came out empty and the run always died on "None of these scenes has an export path". Fixed, and covered end to end by a new browser test that plays both the Daz Runner's and Houdini's part.

A second silent miss on the Houdini side: a network whose `.dth` was picked through the `dth-exports` shortcut the studio puts inside the project folder stores the shortcut's spelling of the path, which never matched the job's real export path — the node was skipped as if it belonged to some other character. The runner now resolves that link on both sides before comparing.

The run also cleans up after itself now: the `.dth_houdini_job.json` and `.dth_houdini_result.json` it writes into the character folder are deleted the moment it ends, instead of being left behind until some later run happened to overwrite them. A job file Houdini never read is kept — that case can be a Houdini the liveness probe hasn't seen yet, and pulling the job out from under it would break the run.

The finished toast also shows what the HDA's pre-flight check complained about. The studio answers its "Continue anyway?" with Yes, so those warnings only ever existed inside the result file — which is now deleted.
