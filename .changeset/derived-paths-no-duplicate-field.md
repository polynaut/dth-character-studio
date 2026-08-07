---
'@dth/desktop': patch
'@dth/web': patch
'@dth/rom': patch
'@dth/ui': patch
---

With a Daz installation activated, **Setup DTH Release** and **Setup DTH
Exporter Plugin** no longer repeat its paths. The library and Studio folder were
still echoed there read-only — the same values the Daz installation card already
lists, shown a second time where they could only ever agree, in the shape of a
field with nothing left to choose.

Each install now states its destination in one line above its buttons —
*"Installs into `D:/DAZ 3D/My DAZ 3D Library`, from the Daz installation
above"* — which is the part that genuinely belongs next to a Dry run / Install.
Without an activated installation both sections keep the editable fields
unchanged.
