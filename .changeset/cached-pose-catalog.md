---
"@dth/web": minor
---

Cache the DTH pose-preset catalog so opening a character is instant.

Scanning the DTH release folder used to run on every character open — with many
releases in the folder that took several seconds each time. Now scanning is a
one-off, explicit step: "Scan DTH release" in Settings resolves the
highest-versioned release (when the folder holds several), scans + classifies
its presets, and writes them to a `pose-catalog.json` cache in the app folder.
Opening or generating a character reads only that cache; it never walks the
release folder. Zipped releases aren't auto-extracted yet — extract the latest
one first (the scan reports this). If the catalog hasn't been built, the editor
points you to Settings to scan.
