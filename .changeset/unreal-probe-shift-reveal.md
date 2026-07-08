---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
---

Unreal cards now correctly detect installed DTH content (the check always read
"missing" for normal Windows paths, leaving the install button hot on projects
that already had `Content/DazToHue` — it re-checks natively now). And
Shift+click is the app-wide "show in Explorer" hotkey: on an Unreal card it
opens the project's folder, on any path chip it replaces the old Ctrl+click.
The chips' hover tooltip is gone — the behaviors are documented in the guide.
