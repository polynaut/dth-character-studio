---
'@dth/web': patch
---

"Export too" now cleans up after itself: the `.dth_houdini_job.json` and `.dth_houdini_result.json` files it writes into the character folder are deleted the moment the run ends, instead of being left behind until some later run happened to overwrite them. A job file that Houdini never read is kept — that case can be a Houdini the liveness probe hasn't seen yet, and pulling the job out from under it would break the run.

The finished toast also shows what the HDA's pre-flight check complained about. The studio answers its "Continue anyway?" with Yes, so those warnings only ever existed inside the result file — which is now deleted.
