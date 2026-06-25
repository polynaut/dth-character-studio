---
'@dth/web': minor
---

Character editor: **Import from CSV** now opens a frame-range dialog after you pick
the file, so a full-scene morph scan (from `DthScanFrames.dsa`) can be sliced to
just the frames that belong to the section you're importing into. The dialog shows
the CSV's frame extent and a live in-range morph count, defaulting to the full
range. Each "Import from CSV" button also gained an info popup explaining how to
produce the CSV, with a link straight to the DazToHue-Scripts installer in Tools.
