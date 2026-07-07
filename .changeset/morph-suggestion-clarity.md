---
'@dth/web': patch
'@dth/rom': patch
'@dth/desktop': patch
---

Morph autocomplete: suggestions now show the Daz UI name on its own labeled
line ("Daz UI name: …"), never truncated — a match on the UI name (e.g.
searching "GPL_…" where the internal name is "GP_…") is clearly readable
instead of looking like a wrong suggestion. The match tag spells it out too
("UI name match" / "internal match").
