# Deep dive: Scenes (optional)

A **scene** is a reusable Daz scene (`.duf`) that **isn't a full character** — a
base figure, a prop, an outfit, a look you start from — that you keep organized
inside a project alongside its characters. It's an **opt-in, per-project** feature.

Think of it as a labelled shelf plus a one-click "open this in Daz" button, not a
character generator. Adding a scene does **not** create or pre-fill a character —
the link to characters stays manual (open the scene in Daz, build your character
from it, save its `.duf`, then add a character pointing at that scene).

---

## Enable it

Scenes are off by default. Open **Settings → Project** (the Project tab only shows
inside a project window) and turn on **Enable scenes**, then Save. The setting is
stored in that project's `.dcsp` file, so you enable it per project that wants it.

<!-- screenshot: Settings → Project → Enable scenes -->

With it **off**, the project shows characters only. With it **on**, the project page
grows a **Characters / Scenes** tab bar, and the "Add" panel gains a **Character /
Scene** choice.

---

## Add a scene

On the **Scenes** tab, press **Add** and fill in:

1. **Choose Daz scene…** — pick the `.duf`. The rest of the form appears once a
   scene is chosen, with a thumbnail preview.
2. **Name** — auto-filled from the file name (e.g. `Kira.duf` → "Kira"); editable.
3. **Description** *(optional)* — what this base is for.
4. **Copy into the `.assets` folder** *(on by default)* — see below.
   - **Subfolder** *(optional)* — organize copies under `.assets/<subfolder>/`.
   - **Delete the original after copying** — makes it a move instead of a copy.
   - Turn the copy switch **off** to **link in place** — the scene stays where it
     is and the scene entry just records its path.

<!-- screenshot: Add scene panel -->

**Copy vs link — the one thing to understand:**

| | Copy (default) | Link |
|---|---|---|
| Where the `.duf` lives | duplicated into the project's `.assets/` | stays where it is |
| Portable with the project | ✅ yes | ❌ points at an external file |
| Removing the scene | deletes the copied `.duf` (optionally kept) | never touches your original |

Each scene card shows its thumbnail (from the scene's `.tip.png`/`.png` sidecar, or
the name's initials), its name/description, a storage badge (`linked`, or
`.assets/<subfolder>`), and two actions: **Open scene in Daz** and **Remove scene**.

---

## Use a scene

The only in-app action is **Open scene in Daz** — it opens the `.duf` in Daz Studio
(Daz must be the registered handler). From there you work in Daz as usual: dial your
character on top of the base, save a new `.duf`, and back in the studio **Add
character** pointing at that saved scene. There is no automatic "make a character
from this scene" step by design — scenes are for organization and a fast launch.

---

## On disk

Everything lives in a hidden **`.assets/`** folder inside the project:

- `.assets/assets.json` — the registry (names, descriptions, scene paths, copy/link
  flags).
- copied scenes (and their thumbnails) under `.assets/` (or `.assets/<subfolder>/`).

There is **no global/shared scene library** — scenes belong to one project only.
Changing the project's characters subfolder never touches `.assets`.

## Good to know

- Opt-in **per project**; re-enable it for each project that wants it.
- `.duf` scenes only.
- Linked scenes never have their source file deleted by the app; copied ones can be
  fully removed (with an optional "keep the files on disk").
- The adjacent **Enable Daz Products** switch is a separate feature — see
  [Daz product scanning](./product-scanning.md).

[← Guide overview](./README.md)
