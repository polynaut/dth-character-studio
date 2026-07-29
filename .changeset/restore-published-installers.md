---
"@dth/web": patch
"@dth/desktop": patch
"@dth/rom": patch
"@dth/ui": patch
---

Republish the installers and the updater feed. The previous release assets were removed during
repository maintenance, which left `releases/latest/download/latest.json` returning 404 and no
downloadable build available. This release restores both the download and the auto-update paths.

Also carries the docs-site screenshot refresh and the phone-lightbox rotation fix.
