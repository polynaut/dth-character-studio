---
'@dth/web': patch
---

fix(web): a finished open-scene handoff's job file is deleted by the studio right away (a detached completion watch), instead of lingering until the next handoff sweeps it. And the bundled Runner is now v1.1.3: pressing **Cancel** in the Save Changes prompt deletes the job file — a deliberate cancel is not an outcome to report.
