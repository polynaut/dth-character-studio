---
'@dth/web': minor
'@dth/desktop': minor
---

**Tools → DazToHue-Scripts now tracks versions.** Installing records the exact commit it downloaded: the installer resolves the HEAD of `soltude/DazToHue-Scripts` `main`, downloads *that commit's* tree (so the files always match the recorded SHA), and writes a `.dth-version.json` marker beside them. The tab then shows whether the installed scripts are **up to date** (green) or an **update is available** (amber) by comparing that commit against the latest on GitHub — and the install button switches to **"Update to latest"** when behind. The check runs when the page opens and degrades to "couldn't check" when offline or rate-limited.
