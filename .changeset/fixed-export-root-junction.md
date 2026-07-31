---
'@dth/desktop': minor
'@dth/rom': minor
'@dth/web': minor
---

feat: the export directory is fixed, and Houdini reaches it through a shortcut

Exports no longer live inside the Houdini project. A Houdini project folder is something you back up, sync or put in version control, and `.abc`/`.dth` files are large and fully regenerable — so they move to the Daz side and Houdini gets a link to them:

- **The export directory is derived, not chosen**: always `<character>/<daz subfolder>/dth-exports`, created with the character and shown read-only on the character page. Existing characters migrate on their next save (Tools → Refresh assets does the lot) — and their **already-exported files move with them**, so nothing is stranded at the old location. Only the folders the studio recorded as its own are moved, never the whole old directory (which for the default layout was the character's Houdini folder, `.hiplc` files and all).
- **One shared Houdini project folder** per character, fixed name `houdini-project`. The first generated project creates it, every later one reuses it, so all of a character's `.hiplc` files open with the same `$JOB`. Removing a generated project now deletes only its scene file.
- **A `dth-exports` junction** inside that folder points at the real export root, so Houdini's file picker — which opens at `$JOB` — lists the exports instead of making you climb two levels out. It needs no admin rights, and it is a convenience only: nothing in the export pipeline resolves through it, so deleting it (or a tool like Perforce doing so) costs nothing but the shortcut, and the next Generate project restores it.

Consequently the **Houdini project folder** field and its per-scene override are gone (schema v29), exports are flat again under the export directory, and deleting a character with *Keep Daz files* no longer silently retains gigabytes of exports. Runtime v47 — Refresh assets regenerates the scripts.
