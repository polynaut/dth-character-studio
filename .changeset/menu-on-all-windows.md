---
'@dth/desktop': patch
---

Show the native menu bar (Main / Help) on every window. Only the startup "main"
window received the app menu; project windows and any extra Home windows opened at
runtime came up with no menu bar. Each runtime window now builds and sets the same
menu itself, so New Project / Refresh assets / About / Check for Updates are
reachable from any window.
