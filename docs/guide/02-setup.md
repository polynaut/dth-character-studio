# 2 · One-time setup

Open **Settings** (top right) → **General** tab. Two things get wired up here:
the **DTH release** (the content your ROMs are built from) and the
**DTH Exporter Plugin** (for exporting out of Daz). Both come from your
[DazToHue](https://www.artstation.com/marketplace/p/BLM5K/daztohue) purchase —
extract the downloaded archives somewhere permanent first.

## Setup DTH Release

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="settings general, DTH release section" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The DTH release section in Settings → General.</em></sub>
</p>
-->

1. **DTH release(s) folder** — point it at the extracted DTH release (or a folder
   holding several release versions; then pick the version to use).

   <p align="center">
     <img width="891" alt="release-folder" src="https://github.com/user-attachments/assets/742cf028-da3c-46bd-907c-ac1e062fa9b6" />
     <br>
     <sub><em>Point the DTH release(s) folder at your extracted release.</em></sub>
   </p>


   After selecting a DTH Release(s) folder, if there are multiple versions detected,
   you can select the **active** one. Adding another release later to the folder won't change the selection!
   You need to actively select the new version in the dropdown and re-install the files for Daz and Houdini.
   
   <p align="center">
     <img width="722" alt="Selecting the active DTH release version" src="https://github.com/user-attachments/assets/070c9f98-fcd8-4698-98b8-9a56bf51bc5c" />
     <br>
     <sub><em>Pick the active version when several releases are detected.</em></sub>
   </p>

   
3. **My DAZ 3D Library** — your Daz content library (where Daz Studio loads content
   from, e.g. `…\Documents\DAZ 3D\Studio\My Library`). Press **Install** below it to
   copy the release's Daz content into the library. **Dry run** previews what would
   be copied.
4. **Houdini documents folder** *(optional)* — your Houdini user folder
   (e.g. `…\Documents\houdini20.5`). Press its **Install** to merge the release's
   Houdini assets (otls, presets, toolbar) into it. Skip this if Houdini isn't on
   this machine.

## Setup DTH Exporter Plugin

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="settings general, exporter plugin section" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The DTH Exporter Plugin section in Settings → General.</em></sub>
</p>
-->

Needed for exporting the ROM out of Daz (step 5) — including the studio's automatic
direct export.

1. **DTH Exporter Plugin release(s) folder** — the extracted Exporter Plugin download.

   <p align="center">
     <img width="725" alt="Exporter Plugin release folder field" src="https://github.com/user-attachments/assets/980485af-0526-42db-8d5c-4723db8b069f" />
     <br>
     <sub><em>Point it at the extracted DTH Exporter Plugin download.</em></sub>
   </p>


3. **Daz Studio install folder** — where Daz Studio itself is installed
   (e.g. `C:\Program Files\DAZ 3D\DAZStudio4`).
4. Press **Install**. Writing into Program Files may require closing Daz and
   restarting the studio as administrator — the app tells you when that's the case.

   <p align="center">
     <img width="594" alt="Administrator rights notice" src="https://github.com/user-attachments/assets/39eb5538-ac57-478f-9b1d-2cfa533a736d" />
     <br>
     <sub><em>The app warns when installing into Program Files needs admin rights.</em></sub>
   </p>

   Usually, Daz Studio is installed in an admin protected folder on C: - in that case,
   just open DTH Character Studio as administrator:

   <p align="center">
     <img width="623" alt="Open the studio as administrator" src="https://github.com/user-attachments/assets/aaf9403b-7f7a-4b1c-8214-ddba2991587a" />
     <br>
     <sub><em>Open DTH Character Studio as administrator to install into a protected folder.</em></sub>
   </p>

## Save

Press **Save** at the top. The studio scans the release's pose presets — you're
ready to create a project.

## The App Data tab

Settings also has an **App Data** tab — the app's own on-disk state:

- **App data folder** — where machine settings, the recent-projects list,
  network-drive mappings and scan outputs live (project data lives in each
  project's own folder). The path chip copies it; Alt+click reveals it.
- **Storage & housekeeping** — the studio ages out **its own** generated data so
  it can't fill your disk: **Clean up now** deletes per-scene
  [product-scan](./product-scanning.md) files and `Scan_Frames` keyframe CSVs
  older than 30 days (also swept automatically on every launch).

(Mapped **network drives** the app remembers show as their own pane at the bottom
of the **General** tab, with a "Re-map missing now" action.)

&nbsp;

> [!NOTE]
> **Extras (later):** the **[Tools](./tools.md)** page can also install your own Daz assets,
> custom morphs, and Daz/Houdini presets into the right places — none of it is
> needed for your first character.

&nbsp;

[← Install the app](./01-installation.md) · [Next: Your first project →](./03-first-project.md)
