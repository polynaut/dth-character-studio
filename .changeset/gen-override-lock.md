---
"@dth/web": minor
---

Sections that change the figure's bone count (GEN — the geografts add bones)
can no longer be overridden per Daz scene: every scene must produce the primary
scene's skeleton, or the scenes' Daz/Houdini artifacts desync. On a non-primary
scene the section is now fully read-only (disabled toggle + body) and its title
wears an amber warning triangle whose tooltip explains why; the primary scene's
setup applies to every scene. Override data stored before this rule still shows
the green section mark so it can be reset.
