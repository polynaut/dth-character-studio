---
'@dth/desktop': minor
'@dth/web': minor
'@dth/rom': minor
---

Daz product scanning runs itself

Scanning your products used to be a chore with three steps: switch the feature on
per project, run a script in Daz, then come back, look at what was found and press
**Store on character**. The middle step is the only one that ever needed you.

Now: **set the DAZ Install Manager manifests folder in Settings, and that's it.**
That folder is the product database, so having it is the only thing a scan needs —
every export run scans the scene it just built, the studio picks the results up on
its own and files them against the character. The review dialog, the Store button
and the "your stored list is older than the scan" banner are all gone; there is
nothing left to keep in sync.

- **The per-project "Daz Products" switch is now "Show the Daz Products tab".** It
  only decides whether the character page shows the tab. Scanning and filing happen
  either way, so switching it on later shows you results already collected.
- **Results are kept per scene**, so re-scanning one outfit replaces only that
  outfit's entry and leaves the others alone. The tab shows them merged.
- **The Daz-written CSVs are deleted once they're read** — they were only ever a
  transport, and they used to pile up in the app's data folder until a 30-day
  age-out swept them.
- **Results moved off the character definition** into
  `<project>/.dcsmeta/characters/<Character>/products.json`, with the studio's other
  per-character files. A few hundred rows of machine-derived data had no business in
  a file meant to be read and shared. Products already stored on a character are
  carried over automatically the first time it is saved or refreshed — nothing to do.

Script runtime v60: every character regenerates on the next **Tools → Refresh
assets**, which is what teaches the existing scripts to scan.
