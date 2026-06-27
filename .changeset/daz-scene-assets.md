---
'@dth/web': minor
---

Add **assets** — reusable Daz scenes you build characters on top of. Assets are **per-project and opt-in**: turn them on for a project in **Settings → Project → Enable assets** (off by default, so a project shows characters only). Once enabled, the project page gains a **Characters / Assets** tab and the create side panel a matching **Asset** tab. There is no global/shared asset library — assets always live inside their project's `.assets` folder.

On the Asset tab you pick a `.duf`, give it a name (prefilled from the file) and an optional description, then either **copy it into a hidden `.assets` folder** (optionally under a subfolder) or **link it in place**. The assets grid shows each scene's thumbnail with open-in-Daz and remove actions; removing a copied asset can keep or delete its files, while a linked asset's source is never touched.

Each project can also set a **Characters subfolder** (Settings → Project): the relative folder character folders are stored under — e.g. `assets/characters` stores them at `<project>/assets/characters/<Character>/`. Empty (the default) keeps them directly in the project root, as before. Changing it **moves the existing character folders** to the new location and repoints the scene / Houdini links inside them.

Inside a project (with assets enabled), dropping a Daz scene (`.duf`) opens the create panel and the picked scene is carried across a Character/Asset tab switch instead of being lost. On the home page, dropping a project (`.dcsp`) opens it and dropping a folder starts a new project there.
