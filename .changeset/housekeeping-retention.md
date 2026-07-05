---
'@dth/web': minor
'@dth/desktop': minor
---

**Housekeeping: the studio's own generated data can no longer fill your disk.** The two things that used to accumulate unbounded are now managed:

- **Product-scan files** (the per-Daz-scene CSVs + diagnostics under app-data) **age out after 30 days** — swept automatically on every app launch, and on demand via a new **Tools → Storage & housekeeping → "Clean up now"** button (reports how much it freed). Deleting a character now also removes its scan folder and avatar immediately, so nothing orphans.
- **The dedup quarantine** (redundant Daz assets you moved aside — a large, reversible backup) is shown with its size in the same section, with an **"Empty quarantine"** button (with a confirm). It's never emptied automatically — you decide when the backup is safe to reclaim.

Everything else the app writes was already bounded (run logs overwrite, generated artifacts self-prune, temp files self-delete, recents capped). New native commands: `housekeeping_sweep`, `folder_stats`, `empty_folder`.
