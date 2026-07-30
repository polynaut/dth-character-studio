---
'@dth/web': minor
---

feat(web): **Open in Daz now works while Daz Studio is already running.** Daz drops a forwarded command-line open once a scene is loaded, so clicking a scene card used to stop at a dialog asking you to close Daz first. The studio now hands the scene to the **Runner plugin** instead — a new one-row, script-less `open-scene` job (contract v3) that opens the scene in the running instance and raises the Daz window, which the studio can't do from outside.

The old dialog is still the fallback, and it arrives on its own: a Runner too old to know the job type treats it as a foreign file and leaves it alone, so the studio takes the job back after a few seconds and behaves exactly as before. No plugin version check, nothing to configure — update the Runner (Settings → General) and the dialog simply stops appearing. Opening with Daz closed still launches it fresh, unchanged.

A scene open is refused while an export batch is waiting or running: there is one job file and the Runner works one batch at a time.
