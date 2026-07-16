---
'@dth/web': minor
'@dth/rom': patch
---

Scan_Frames ships with the studio: the keyframe-scan script (formerly DazToHue-Scripts' DthScanFrames) installs into Scripts/DTH-Character-Studio like the other scan scripts and writes its CSV — one per Daz scene — into the studio's own scan folder. "Import from CSV" now opens a picker listing those scans (newest first) with a Browse fallback for hand-curated files. The Tools → DazToHue-Scripts download/installer is gone — everything the workflow needs is bundled; the scan folder is bounded by the housekeeping sweep (30 days).
