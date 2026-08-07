---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

The material transfer now refuses a target built from a different figure instead
of merely noting it. A material setup only transfers within one Genesis version,
and the studio checks that without any generation knowledge: the Daz surfaces
your selected materials claim are matched against the ones the target actually
has. Some unclaimed is normal — the source wears a dress this character doesn't
— but when none match, the two nodes describe different figures and Transfer is
disabled with the target named, because the copied slots would name surfaces
that aren't there and every baker would bake nothing. A node with no material
slots yet is never blocked: there is nothing to contradict, and seeding one from
a template is what the drawer is for.
