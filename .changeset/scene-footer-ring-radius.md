---
'@dth/web': patch
---

fix(web): the selected Daz scene's ring in the footer hugs the pill

The ring wrapper used `rounded-lg` while the pill inside (`Tag`) uses `rounded`, so
the green selection ring bulged past the pill's corners. Match the wrapper's radius to
the pill's so the ring follows its silhouette.
