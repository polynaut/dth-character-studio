---
'@dth/web': patch
---

**Export only** now verifies every selected scene's saved ROM animation before handing the batch to Daz. Start waits as **Checking scenes…** while the dialog's scene probe is still running (a row checked in that window can no longer start on unknown state), and the check runs again at Start itself — a ROM animation deleted after the dialog opened is now refused in the dialog, which names the scenes and points at **ROM + Export** or **ROM only**, instead of starting on a stale go-ahead. A scene whose `.duf` file is missing is no longer pre-checked just because a saved ROM animation survives beside it, and a selected row that turns out to be unrunnable can now be unselected (previously its checkbox was disabled outright, checked or not).
