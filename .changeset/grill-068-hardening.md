---
# bump: patch is deliberate — hardening of features that ship in this same
# release (no new capability; the review that found these is PR #731's grill)
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
---

Hardening for this release's features, from an adversarial review before it
shipped: the product-scan pickup can no longer consume a CSV Daz is still
writing (the writer now closes each file with an end marker, runtime v61), a
pre-update character's stored products survive leftover scan files, re-scans
replace carried-over entries instead of duplicating them, changing the DIM
manifests folder now marks generated scripts out of date, "Export too" fills a
blank export directory with the character's `export/` folder (not the
`dth-exports` intermediate), Fill network offers a wired network its OWN
scene's paths, and a stale scene pick in Generate project errors instead of
silently wiring the primary.
