---
'@dth/web': patch
---

**Export only** now refuses to start while any selected scene has no saved ROM animation, instead of failing in the middle of the run. The dialog names the scenes that are missing one and points you at **ROM + Export** or **ROM only** for them. Previously the row for such a scene was disabled — but a selection made before the scene probe finished (or after it failed) could still slip through and only surface as an error once the dialog had already closed.
