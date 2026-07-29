---
"@dth/web": patch
"@dth/desktop": patch
"@dth/rom": patch
"@dth/ui": patch
---

Republish the installers and the updater feed. The previous release assets were removed during
repository maintenance, which left `releases/latest/download/latest.json` returning 404 and no
downloadable build available. This release restores both the download and the auto-update paths.

Also lifts the bulk-selection pill clear of the Unreal-projects footer on the project overview —
it was sitting flush on the footer's top edge with no gap — and carries the docs-site screenshot
refresh and the phone-lightbox rotation fix.
