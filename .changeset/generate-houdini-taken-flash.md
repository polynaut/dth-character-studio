---
'@dth/web': patch
---

Generate Houdini project: no more red "name already exists" flash under the name input while the dialog closes after a successful generation — the dialog was catching its own freshly created project in the live collision check.
