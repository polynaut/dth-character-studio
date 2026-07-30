---
'@dth/web': minor
---

feat(web): show the exact installed Runner plugin version and gate DTH Export on it.

- The Settings Runner section now reads the installed DLL's version resource and shows it like the Exporter Plugin's ("Installed: 1.0.3 → updating to 1.0.5"), instead of just "a different Runner DLL is installed".
- The DTH Export dialog blocks Start while the Runner plugin is missing or older than the bundled one — the jobs would run with stale behaviour (or never get picked up). A notice explains the state and deep-links to Settings → General; a Runner NEWER than the bundle does not block.
