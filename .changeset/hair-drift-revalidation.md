---
'@dth/web': patch
---

Hair drift is caught the moment it happens. The hair-items warnings re-check when the Daz scene file is saved on disk (a file watch on the scene's folder) — editing hair in Daz on a second monitor and saving no longer leaves the studio judging the old scene until the window regained focus. And the "unlisted hair — it'd ride into the export" warning now fires on the **primary** scene too, not only outfit scenes: the primary starts complete (seeded at creation) but drifts exactly the same way once the scene is re-styled and saved. Both warnings — a listed item gone from the scene (the export stops on it) and detected hair the list doesn't cover — come from one shared rule.
