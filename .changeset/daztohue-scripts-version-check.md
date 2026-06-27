---
'@dth/web': minor
'@dth/desktop': minor
---

**Tools → DazToHue-Scripts now tracks versions.** Installing records the exact commit it downloaded: the installer resolves the HEAD of `soltude/DazToHue-Scripts` `main`, downloads *that commit's* tree (so the files always match the recorded SHA), and writes a `.dth-version.json` marker beside them. The tab then shows whether the installed scripts are **up to date** or an **update is available** by comparing that commit against the latest on GitHub — phrased and styled to match the DTH Exporter Plugin status (a green ✓ "Already installed (X) — up to date." line, **Install / Update / Reinstall** button). The check runs when the page opens and degrades to "couldn't check" when offline or rate-limited.

The DTH Exporter Plugin status in Settings gets the matching treatment too — the same green checkmark on its "Already installed … up to date." line and consistent text sizing across all of its status lines.
