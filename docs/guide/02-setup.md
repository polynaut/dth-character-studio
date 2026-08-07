# 2 · One-time setup

Open **Settings** (top right) → **General** tab. Three things get wired up here:
your **Daz installation**, the **DTH release** (the content your ROMs are built
from) and the **DTH Exporter Plugin** (for exporting out of Daz). The last two
come from your
[DazToHue](https://www.artstation.com/marketplace/p/BLM5K/daztohue) purchase —
extract the downloaded archives somewhere permanent first.

## Daz installation — pick it once

You already told the **DAZ Install Manager** where Daz Studio, your content
library and its product database live. The studio reads that rather than asking
again: every Daz Studio DIM has installed appears as a card at the top of
**Settings → General**.

<p align="center">
  <img width="900" alt="Daz installation cards with the derived read-only paths" src="screenshots/settings-daz-install.png" />
  <br>
  <sub><em>Both Daz Studios found; DAZ Studio 6 activated, and the paths it derives shown read-only.</em></sub>
</p>

Click one to **activate** it. Three paths are filled from it and saved
immediately — there is no Save to press, because the paths follow from the
choice:

| Path | Where it comes from |
| --- | --- |
| **My DAZ 3D Library** | the library DIM currently installs into |
| **Daz Studio install folder** | that card's own install folder |
| **DAZ Install Manager manifests folder** | DIM's product database (see [Product scanning](./product-scanning.md)) |

They show read-only underneath the cards while an installation is active — an
editable copy of a derived path is one that can quietly disagree with what
produced it.

> **Both Daz Studio 4 and 6 installed?** Both get a card and the newest is
> marked *recommended*, but nothing is activated until you click. Only the
> **install folder** follows the card — the library and product database belong
> to DIM, not to one Studio version, so switching cards leaves them alone.

**Nothing detected, or a machine DIM doesn't describe?** The section says so and
the three paths stay ordinary editable fields, exactly as before. The same
applies on purpose after activating: **Set the paths manually** hands them back,
keeping their current values.

## Setup DTH Release

<p align="center">
  <img width="900" alt="settings general, DTH release section" src="screenshots/settings-dth-release.png" />
  <br>
  <sub><em>The DTH release section in Settings → General.</em></sub>
</p>

1. **DTH release(s) folder** — point it at the extracted DTH release, or at a
   folder holding several versions; then pick the **active** one in the
   dropdown. A release added later must be selected (and installed) yourself —
   the selection never changes on its own.
2. **My DAZ 3D Library** — your Daz content library (where Daz Studio loads
   content from, e.g. `…\Documents\DAZ 3D\Studio\My Library`). Already filled if
   you activated a Daz installation above. Press **Install** below it to copy
   the release's Daz content into the library; **Dry run** previews what would
   be copied.
3. **Houdini documents folder** *(optional)* — your Houdini user folder
   (e.g. `…\Documents\houdini20.5`). Press its **Install** to merge the
   release's Houdini assets (otls, presets, toolbar) into it. Skip this if
   Houdini isn't on this machine.
4. **Add another Houdini folder** *(optional)* repeats step 3 for a second
   Houdini version: each extra folder installs its release independently, so
   an older Houdini can keep an older DTH release.

## Setup DTH Exporter Plugin

Needed for exporting the ROM out of Daz (step 5) — including the studio's
automatic direct export.

1. **DTH Exporter Plugin release(s) folder** — the extracted Exporter Plugin
   download.

   <p align="center">
     <img width="900" alt="Exporter Plugin release folder field" src="screenshots/settings-exporter-plugin.png" />
     <br>
     <sub><em>Point it at the extracted DTH Exporter Plugin download.</em></sub>
   </p>

2. **Daz Studio install folder** — where Daz Studio itself is installed
   (e.g. `C:\Program Files\DAZ 3D\DAZStudio4`). Already filled if you activated
   a Daz installation above, and it is the card you activated that decides
   *which* Daz Studio the plugin installs into.
3. Press **Install**. Daz Studio usually sits in an admin-protected folder on
   `C:` — the app tells you when that's the case: close Daz, then reopen
   DTH Character Studio as administrator and install again.

   <p align="center">
     <img width="594" alt="Administrator rights notice" src="https://github.com/user-attachments/assets/39eb5538-ac57-478f-9b1d-2cfa533a736d" />
     <br>
     <sub><em>The app warns when installing into Program Files needs admin rights.</em></sub>
   </p>

   <p align="center">
     <img width="623" alt="Open the studio as administrator" src="https://github.com/user-attachments/assets/aaf9403b-7f7a-4b1c-8214-ddba2991587a" />
     <br>
     <sub><em>Open DTH Character Studio as administrator to install into a protected folder.</em></sub>
   </p>

## Install the DTH Character Studio Runner Plugin

The **Runner plugin** ships **inside the app** — nothing to download. It lets
the studio drive Daz Studio: the
[**DTH Export** batch](./05-rom-in-daz.md#batch-export--dth-export),
[**Tools → Scan & index → Scan project**](./tools.md#tab-1--scan-amp-index),
and opening scenes in an already-running Daz all go through it. With the Daz Studio install
folder set (above), press **Install** — the panel shows the bundled version,
the exact version installed in Daz, and says when an update is pending. The
same admin note as above applies, and Daz must be closed (a running Daz locks
its plugins).

## Save

Press **Save** at the top. The studio scans the release's pose presets — you're
ready to create a project.

## The App Data tab

Settings also has an **App Data** tab — the app's own on-disk state:

- **App data folder** — machine settings, the recent-projects list,
  network-drive mappings and scan outputs (project data lives in each project's
  own folder). The path chip copies it; Alt+click reveals it.
- **Storage & housekeeping** — the studio ages out **its own** generated data
  so it can't fill your disk: **Clean up now** deletes per-scene
  [product-scan](./product-scanning.md) files and `Scan_Frames` keyframe CSVs
  older than 30 days, plus **note media no note references anymore** after
  7 days (all three also swept automatically on every launch).

(Mapped **network drives** the app remembers show as their own pane at the
bottom of the **General** tab, with a "Re-map missing now" action.)

&nbsp;

> [!NOTE]
> **Extras (later):** the **[Tools](./tools.md)** page can also install your
> own Daz assets, custom morphs, and Daz/Houdini presets into the right
> places — none of it is needed for your first character.

&nbsp;

[← Install the app](./01-installation.md) · [Next: Your first project →](./03-first-project.md)
