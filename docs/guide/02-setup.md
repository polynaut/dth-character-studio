# 2 · One-time setup

Open **Settings** (top right) → **General** tab. Two things get wired up here:
the **DTH release** (the content your ROMs are built from) and the
**DTH Exporter Plugin** (for exporting out of Daz). Both come from your
[DazToHue](https://www.artstation.com/marketplace/p/BLM5K/daztohue) purchase —
extract the downloaded archives somewhere permanent first.

## Setup DTH Release

<!-- screenshot: settings general, DTH release section -->

1. **DTH release(s) folder** — point it at the extracted DTH release (or a folder
   holding several release versions; then pick the version to use).

   <img width="891" height="630" alt="Screenshot 2026-07-13 181638" src="https://github.com/user-attachments/assets/9a584bf1-c3e7-4890-81f9-7447124a5726" />

   After selecting a DTH Release(s) folder, if there are multiple versions detected,
   you can select the **active** one. Adding another release later to the folder won't change the selection!
   You need to actively select the new version in the dropdown and re-install the files for Daz and Houdini.
   
   <img width="722" height="624" alt="Screenshot 2026-07-13 181744" src="https://github.com/user-attachments/assets/070c9f98-fcd8-4698-98b8-9a56bf51bc5c" />

   
3. **My DAZ 3D Library** — your Daz content library (where Daz Studio loads content
   from, e.g. `…\Documents\DAZ 3D\Studio\My Library`). Press **Install** below it to
   copy the release's Daz content into the library. **Dry run** previews what would
   be copied.
4. **Houdini documents folder** *(optional)* — your Houdini user folder
   (e.g. `…\Documents\houdini20.5`). Press its **Install** to merge the release's
   Houdini assets (otls, presets, toolbar) into it. Skip this if Houdini isn't on
   this machine.

## Setup DTH Exporter Plugin

<!-- screenshot: settings general, exporter plugin section -->

Needed for exporting the ROM out of Daz (step 5) — including the studio's automatic
direct export.

1. **DTH Exporter Plugin release(s) folder** — the extracted Exporter Plugin download.

   <img width="725" height="296" alt="Screenshot 2026-07-13 192636" src="https://github.com/user-attachments/assets/980485af-0526-42db-8d5c-4723db8b069f" />


3. **Daz Studio install folder** — where Daz Studio itself is installed
   (e.g. `C:\Program Files\DAZ 3D\DAZStudio4`).
4. Press **Install**. Writing into Program Files may require closing Daz and
   restarting the studio as administrator — the app tells you when that's the case.

   <img width="594" height="123" alt="Screenshot 2026-07-13 193734" src="https://github.com/user-attachments/assets/39eb5538-ac57-478f-9b1d-2cfa533a736d" />
   Usually, Daz Studio is installed in an admin protected folder on C: - in that case,
   just open DTH Character Studio as administrator:

   <img width="623" height="122" alt="Screenshot 2026-07-13 192819" src="https://github.com/user-attachments/assets/aaf9403b-7f7a-4b1c-8214-ddba2991587a" />

## Save

Press **Save** at the bottom. The studio scans the release's pose presets — you're
ready to create a project.

> **Extras (later):** the **Tools** page can also install your own Daz assets,
> custom morphs, and Daz/Houdini presets into the right places — none of it is
> needed for your first character.

[← Install the app](./01-installation.md) · [Next: Your first project →](./03-first-project.md)
