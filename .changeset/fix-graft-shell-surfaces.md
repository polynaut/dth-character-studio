---
'@dth/web': minor
'@dth/rom': minor
---

**New Daz script: Fix graft shell surfaces.** Fitting a nipple or navel geograft
(STX and friends) to a figure that already wears **Golden Palace** or **Dicktator**
adds that graft's surfaces to the genital shells — switched **on** — so the shell
renders over the new graft and you get shell material where the graft should be.
The fix has been to hunt down each `stx_…_Body` row in the shell's
*Shell › Visibility › Surfaces* list and switch it off by hand, on every shell, in
every scene.

`Fix_Graft_Shell_Surfaces` now does it in one run: open the scene, run the script
from **Scripts › DTH-Character-Studio** in the Content Library, and it switches off
every foreign-graft surface on the GP/DK shells. Nothing to select, and it is safe
to re-run — only rows that are still on get written.

It is deliberately narrow: other geoshells (skin overlays, tattoos, nail shells) are
left alone, since those legitimately want the graft surfaces visible, and a shell's
own graft always keeps its rows. A scene with no GP/DK shell is a no-op. If the
script cannot tell which graft a shell belongs to it reports that shell as skipped
rather than guessing — guessing wrong would blank the shell itself.

Run **Tools → Refresh assets** once to install the new script (and its icon) into an
existing scripts folder.
