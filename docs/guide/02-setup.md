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
2. **My DAZ 3D Library** — your Daz content library (where Daz Studio loads content
   from, e.g. `…\Documents\DAZ 3D\Studio\My Library`). Press **Install** below it to
   copy the release's Daz content into the library. **Dry run** previews what would
   be copied.
3. **Houdini documents folder** *(optional)* — your Houdini user folder
   (e.g. `…\Documents\houdini20.5`). Press its **Install** to merge the release's
   Houdini assets (otls, presets, toolbar) into it. Skip this if Houdini isn't on
   this machine.

## Setup DTH Exporter Plugin

<!-- screenshot: settings general, exporter plugin section -->

Needed for exporting the ROM out of Daz (step 5) — including the studio's automatic
direct export.

1. **DTH Exporter Plugin release(s) folder** — the extracted Exporter Plugin download.
2. **Daz Studio install folder** — where Daz Studio itself is installed
   (e.g. `C:\Program Files\DAZ 3D\DAZStudio4`).
3. Press **Install**. Writing into Program Files may require closing Daz and
   restarting the studio as administrator — the app tells you when that's the case.

## Save

Press **Save** at the bottom. The studio scans the release's pose presets — you're
ready to create a project.

> **Extras (later):** the **Tools** page can also install your own Daz assets,
> custom morphs, and Daz/Houdini presets into the right places — none of it is
> needed for your first character.

[← Install the app](./01-installation.md) · [Next: Your first project →](./03-first-project.md)
