# 3 · Your first project

A project groups the characters of one production (a game, a film, a series of
commissions). On disk it is simply a **folder you choose**, marked by a single
**`.dcsp`** project file — keep it wherever you keep that production's files,
back it up with them, and you're done.

## Create it

<p align="center">
  <img width="900" alt="home screen, new project panel" src="screenshots/home-new-project.png" />
  <br>
  <sub><em>The New project panel on the Home screen.</em></sub>
</p>

1. On the **Home** screen press **New project**.
2. **Choose folder…** — pick the folder the project should live in. You can
   also just drop a folder anywhere onto the Home screen.
3. Give it a **Project name** and press **Create**.

The project opens **in its own window**. From now on you can also open it by
double-clicking the `.dcsp` file in Explorer, or from the Home screen's recent
list:

<p align="center">
  <img width="900" alt="Home screen with the project in the recent list" src="screenshots/home.png" />
  <br>
  <sub><em>The Home screen — recently opened projects reopen with one click.</em></sub>
</p>

<p align="center">
  <img width="900" alt="Project open in its own window" src="screenshots/project-open-window.png" />
  <br>
  <sub><em>The project opens in its own window.</em></sub>
</p>


## Good to know

- Every character you create becomes a **subfolder of the project** —
  definition, scenes, and generated files live together, so the project folder
  is fully self-contained and portable.
- The project page has more tabs beside **Characters**: **Notes** (freeform
  markdown for the whole project — images can be dropped straight in) and
  **Operations** (the project-level danger zone: deleting the project, which
  refuses while its files are open in Daz or Houdini). Enabling
  [Assets](./attachments.md) adds an **Attachments** tab.
- Per-project options (folder layout, the optional [Assets](./attachments.md)
  and [Daz Products](./product-scanning.md) features) live in
  **Settings → Project** — the defaults are fine for a first run. One is
  destructive: changing **Characters subfolder** later *moves* the existing
  character folders (their scene and Houdini links are repointed).

- **Path chips** — the monospace path badges all over the app — **copy the
  full path on click**; **Alt+click opens the location in Explorer** (for a
  file, its folder). Where a chip carries a pencil, it edits the value in
  place. The same Alt+click works on every linked card — Daz scenes, Houdini
  projects and Unreal projects.

  <p align="center">
    <img width="372" alt="Clicking a path chip copies the full path" src="clips/path-chip-copy.webp" />
    <br>
    <sub><em>Hover shows the copy badge; a click copies the full path.</em></sub>
  </p>

  <p align="center">
    <img width="160" alt="A path chip with Alt held — click opens the location in Explorer" src="screenshots/detail-path-chip-alt.png" />
    <br>
    <sub><em>Holding <strong>Alt</strong> flips the badge to a folder — Alt+click opens the path's location in Explorer.</em></sub>
  </p>

## Linking Unreal projects

The bar docked to the bottom of the project window holds the **Unreal
projects** this studio project feeds. Link one or more `.uproject` files with
the button or by dropping them onto the bar — links only: the files stay where
they are, and unlinking never deletes anything.

- **The open button** on a card launches the project in Unreal Engine;
  **Alt+click** shows it in Explorer instead. The card's path chip works like
  every path chip (click copies, Alt+click reveals). The rest of the card is
  inert — no accidental launches.
- **The small install button** on each card opens the **install dialog**: what
  goes into this Unreal project — the linked DTH release's *Unreal Engine
  Content* (into `Content/DazToHue`), the **DTH Character Studio Runner** — marked
  **built in**, because it ships inside the app rather than coming from your
  plugin folders (and carries a version, so a card shows an amber ⚠ when its
  project holds an older copy than the app ships — re-install and restart the
  editor once); it is the small Python plugin that makes
  [Send to Unreal](./06-into-houdini.md#send-to-unreal) work, so restart the
  editor once after installing it — plus every plugin build from your
  [Unreal Engine Plugins folders](./02-setup.md#unreal-engine-plugins) that
  matches this project's engine version (read from its `.uproject` when the
  dialog opens). Everything is pre-checked; uncheck what you don't want and
  press **Install**. A checked item that is already in the project is
  overwritten with the offered build (project-local additions inside the
  folders survive — installing never deletes first). The button dims once
  `Content/DazToHue` exists, but stays clickable — reinstalls and plugins live
  in the dialog. A project whose engine association is a source-build GUID
  lists every build unchecked instead: only you know what fits it.
- **The ✨ Generate button** (next to *Add project*) creates a **fresh
  Blueprint-only Unreal project** for one of the engine versions the Epic
  launcher has installed, installs the checked DTH content + plugins into it in
  the same run, and links it to this studio project — a DTH-ready Unreal
  project from nothing, without opening Unreal first. It opens **prefilled**:
  the project's own name, and an **`unreal` subfolder of the project folder**
  as the location, so the Unreal side lands beside `daz3d/` and the characters.
  Both are editable and **Browse** puts it anywhere else. (Unreal accepts
  letters, digits and `_` only, and no leading digit, so a studio project called
  `3d-workflow` is suggested as `_3d_workflow`.)

<p align="center">
  <img width="900" alt="Unreal projects footer bar with a linked project card" src="screenshots/project-unreal-footer.png" />
  <br>
  <sub><em>A linked Unreal project card in the footer bar.</em></sub>
</p>

[← One-time setup](./02-setup.md) · [Next: Your first character →](./04-first-character.md)
