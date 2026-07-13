# 3 · Your first project

A project groups the characters of one production (a game, a film, a series of
commissions). On disk it is simply a **folder you choose**, marked by a single
**`.dcsp`** project file — keep it wherever you keep that production's files,
back it up with them, and you're done.

## Create it

<!-- screenshot: home screen, new project panel -->

1. On the **Home** screen press **New project**.
2. **Choose folder…** — pick (or create) the folder the project should live in.
   You can also just drop a folder anywhere onto the Home screen.
3. Give it a **Project name** and press **Create**.

   <img width="722" height="518" alt="Screenshot 2026-07-13 201354" src="https://github.com/user-attachments/assets/d3ce515a-3976-4d30-9451-4ba3019f901a" />


The project opens **in its own window**. From now on you can also open it by
double-clicking the `.dcsp` file in Explorer, or from the Home screen's recent list.

<img width="722" height="518" alt="Screenshot 2026-07-13 201443" src="https://github.com/user-attachments/assets/63172959-d279-43b6-911b-a12b845814c9" />


## Good to know

- Every character you create becomes a **subfolder of the project** — definition,
  scenes, and generated files live together, so the project folder is fully
  self-contained and portable.  
- Per-project options (folder layout, optional Assets and Daz Products features)
  live in **Settings → Project** — the defaults are fine for a first run.
  
   <img width="722" height="518" alt="Screenshot 2026-07-13 201544" src="https://github.com/user-attachments/assets/8a59ab2a-9cc6-4499-86ad-bb6e51b82c03" />
  
- **Path chips** — the monospace path badges all over the app — **copy the full
  path on click** (a check mark confirms it); **Alt+click opens the location
  in Explorer** (for a file, its folder). Where a chip carries a pencil, it
  edits the value in place. The same Alt+click works on every linked card —
  Daz scenes, Houdini projects and Unreal projects.

  <img width="119" height="25" alt="Screenshot 2026-07-13 201815" src="https://github.com/user-attachments/assets/959dcba5-8245-470d-99d7-c7a7b8507aed" />

## Linking Unreal projects

The bar docked to the bottom of the project window holds the **Unreal projects**
this studio project feeds. Link one or more `.uproject` files with the button or
by dropping them onto the bar — links only: the files stay where they are, and
unlinking never deletes anything.

<img width="727" height="62" alt="Screenshot 2026-07-13 201952" src="https://github.com/user-attachments/assets/f899c95b-d660-4c18-a0bf-995f4e995d29" />


- **Click a card** to open that project in Unreal Engine — **Alt+click** shows it
  in Explorer instead.
- **The small install button** on each card bootstraps the Unreal project with
  DTH: it copies the linked DTH release's *Unreal Engine Content* into the
  project's `Content/DazToHue` — a fresh Unreal project is DTH-ready in one
  click. The button dims once the folder exists; **Ctrl+click always installs**,
  overwriting the content with whatever release is currently selected in
  Settings (handy after switching the DTH release — files are copied over,
  project-local additions inside the folder survive).

<!-- screenshot: Unreal projects footer bar with a linked project card -->

[← One-time setup](./02-setup.md) · [Next: Your first character →](./04-first-character.md)
