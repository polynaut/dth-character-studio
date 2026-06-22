---
'@dth/web': patch
---

Removed the unused "Target skeleton" (UE5 / DTH) field. It was never read during generation — the PoseAsset CSV is always the UE5 template, and the DTH skeleton node doesn't support CSV import yet — so it was a choice that looked like it mattered but didn't. Dropped the dropdown, the list column, the schema field, and the prefill copy. Existing characters keep working (the stored value is simply ignored).
