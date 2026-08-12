---
'@dth/web': minor
---

**A Recently used source can be taken back out.**

The Utils drawer's shortcut row remembers every source you pick — including the
one-off "let me just look at this file" — so it needed a way out as much as a
way in. Each chip now carries a **✕**.

Removing a shortcut is not removing a file: the entry is a remembered path, the
`.hip` is untouched, and picking it again puts it straight back at the top of
the row.
