---
"@dth/web": patch
---

Gender is baked at character creation and never changes again: the
missing-primary relink flow no longer re-derives it (it still re-derives the
GEN section from the new scene's geograft), and the Gender tooltip/guide say
"set at creation" instead of suggesting a relink path that doesn't exist for
a healthy character.
