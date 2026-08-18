---
'@dth/web': patch
---

Fix the "Waiting for Daz Studio to close…" flow: the studio now reliably starts Daz Studio itself once the closing process is gone — a failed launch is retried every second (and surfaced in the dialog after repeated failures), and a launch that dies against a not-fully-dead Daz instance is detected and relaunched instead of being reported as success. The dialog also can no longer get stuck open: it stands down as soon as the batch shows real work (including progress-log activity, which the old check missed for one-scene batches) and always closes itself once the batch finished or was aborted — the contradictory "export finished + still waiting for Daz to close" state is gone. Every other way out is bounded too: the relaunches are spaced and capped (a Daz that keeps exiting is reported instead of started once a second), a job file that stays unreadable ends the wait, and the retry message now names whether the launch or the status check is what failed.
