---
'@dth/web': patch
---

fix(web): the Daz Studio window comes to the front when a scene is opened in a running instance. The Runner raises it plugin-side, but Windows denies that while the studio holds the foreground — the studio now pulls Daz forward itself the moment the handoff is claimed (the same focus helper the Explorer-open flow uses).
