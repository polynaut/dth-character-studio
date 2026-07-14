# 3 · Your first project

A project groups the characters of one production (a game, a film, a series of
commissions). On disk it is simply a **folder you choose**, marked by a single
**`.dcsp`** project file — keep it wherever you keep that production's files,
back it up with them, and you're done.

## Create it

<p align="center">
  <img width="900" alt="home screen, new project panel" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The New project panel on the Home screen.</em></sub>
</p>

1. On the **Home** screen press **New project**.
2. **Choose folder…** — pick (or create) the folder the project should live in.
   You can also just drop a folder anywhere onto the Home screen.
3. Give it a **Project name** and press **Create**.

   <p align="center">
     <img width="722" alt="Naming the new project" src="https://github.com/user-attachments/assets/d3ce515a-3976-4d30-9451-4ba3019f901a" />
     <br>
     <sub><em>Give the project a name and press Create.</em></sub>
   </p>


The project opens **in its own window**. From now on you can also open it by
double-clicking the `.dcsp` file in Explorer, or from the Home screen's recent list.

<p align="center">
  <img width="722" alt="Project open in its own window" src="https://github.com/user-attachments/assets/63172959-d279-43b6-911b-a12b845814c9" />
  <br>
  <sub><em>The project opens in its own window.</em></sub>
</p>


## Good to know

- Every character you create becomes a **subfolder of the project** — definition,
  scenes, and generated files live together, so the project folder is fully
  self-contained and portable.  
- Per-project options (folder layout, optional Assets and Daz Products features)
  live in **Settings → Project** — the defaults are fine for a first run.
  
   <p align="center">
     <img width="722" alt="Settings → Project tab" src="https://github.com/user-attachments/assets/8a59ab2a-9cc6-4499-86ad-bb6e51b82c03" />
     <br>
     <sub><em>Per-project options live in Settings → Project.</em></sub>
   </p>
  
- **Path chips** — the monospace path badges all over the app — **copy the full
  path on click** (a check mark confirms it); **Alt+click opens the location
  in Explorer** (for a file, its folder). Where a chip carries a pencil, it
  edits the value in place. The same Alt+click works on every linked card —
  Daz scenes, Houdini projects and Unreal projects.

  <p align="center">
    <img width="119" alt="A path chip" src="https://github.com/user-attachments/assets/959dcba5-8245-470d-99d7-c7a7b8507aed" />
    <br>
    <sub><em>A path chip copies its full path on click.</em></sub>
  </p>

## Linking Unreal projects

The bar docked to the bottom of the project window holds the **Unreal projects**
this studio project feeds. Link one or more `.uproject` files with the button or
by dropping them onto the bar — links only: the files stay where they are, and
unlinking never deletes anything.

<p align="center">
  <img width="727" alt="Unreal projects bar with a linked project" src="https://github.com/user-attachments/assets/f899c95b-d660-4c18-a0bf-995f4e995d29" />
  <br>
  <sub><em>The Unreal projects bar docked at the bottom of the window.</em></sub>
</p>


- **Click a card** to open that project in Unreal Engine — **Alt+click** shows it
  in Explorer instead.
- **The small install button** on each card bootstraps the Unreal project with
  DTH: it copies the linked DTH release's *Unreal Engine Content* into the
  project's `Content/DazToHue` — a fresh Unreal project is DTH-ready in one
  click. The button dims once the folder exists; **Ctrl+click always installs**,
  overwriting the content with whatever release is currently selected in
  Settings (handy after switching the DTH release — files are copied over,
  project-local additions inside the folder survive).

<p align="center">
  <img width="900" alt="Unreal projects footer bar with a linked project card" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>A linked Unreal project card in the footer bar.</em></sub>
</p>

[← One-time setup](./02-setup.md) · [Next: Your first character →](./04-first-character.md)
