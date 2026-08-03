---
'@dth/web': patch
---

**Renaming a character's Daz scenes folder now takes its export folder with it.** The export root is derived, and it was derived from the *project's* Daz subfolder — so renaming `daz3d` to something else moved `dth-exports` along with the folder and then pointed the character straight back at the old, now-missing location. It follows the character's actual scenes folder now.

The `dth-exports` shortcuts Houdini resolves through are also **re-pointed on every save**, so they survive everything that can move a character's export folder: renaming the character or its folder, renaming the Daz scenes folder, moving the project's characters root, and the one-time export-root migration. Previously only **Generate project** created them, and they kept aiming at wherever the exports used to be.
