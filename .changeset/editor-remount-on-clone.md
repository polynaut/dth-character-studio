---
"@dth/web": patch
---

Cloning a character is now a proper flow. The **Clone** button opens a dialog to
name the copy (pre-filled "<name> copy") and choose whether to **copy its Daz
scenes** — scenes stored in the character folder are copied into the copy, while
scenes linked in place are kept as links (their files untouched). After cloning,
the editor now actually lands on the new copy: it's keyed by the character id, so
an editor→editor navigation remounts and re-seeds from the copy (previously only
the URL changed while the editor kept showing the original).
