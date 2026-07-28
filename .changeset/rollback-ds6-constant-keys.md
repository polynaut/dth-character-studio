---
'@dth/web': patch
'@dth/rom': patch
---

The DS6 Constant-keyframe workaround (runtime v17) is rolled back — every ROM morph key is Linear again on Daz Studio 4 AND 6, matching the upcoming DTH release: Constant keys didn't actually solve DS6's key drift and introduced headaches with the DK9 ROM. Runtime v35; run Tools → Refresh assets and re-run the ROM script in Daz to re-key existing timelines.
