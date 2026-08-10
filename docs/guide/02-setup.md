# 2 · One-time setup

Open **Settings** (top right) → **General** tab. Three things get wired up here:
your **Daz installation**, the **DTH release** (the content your ROMs are built
from) and the **DTH Exporter Plugin** (for exporting out of Daz). The last two
come from your
[DazToHue](https://www.artstation.com/marketplace/p/BLM5K/daztohue) purchase —
extract the downloaded archives somewhere permanent first.

The first two are usually already done for you: the tab opens with every Daz
Studio and every Houdini on the machine listed as a card. Click the one you
want and its paths are filled in and saved.

<p align="center">
  <img width="900" alt="Settings → General with a Daz Studio and a Houdini installation card activated" src="screenshots/settings-installations.png" />
  <br>
  <sub><em>Both detections, each with a card activated: DAZ Studio 6 and Houdini 22.0.368, with the paths they derive shown read-only beneath.</em></sub>
</p>

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

Click one to **activate** it. Three paths are filled and saved on the spot —
there is no Save to press:

| Path | Where it comes from |
| --- | --- |
| **My DAZ 3D Library** | the library DIM currently installs into |
| **Daz Studio install folder** | that card's own install folder |
| **DAZ Install Manager manifests folder** | DIM's product database (see [Product scanning](./product-scanning.md)) |

They stay read-only while an installation is active, and they follow DIM: move
your library later and opening Settings picks it up, with nothing to
re-activate. The newest Studio is marked *recommended*, but nothing activates
itself, and switching cards changes only the install folder — the other two
belong to DIM, not to one Studio version.

**No DIM, or a machine it doesn't describe?** The section says so and the three
paths stay ordinary editable fields. **Set the paths manually** does the same
after activating, keeping the values.

## Houdini installation — same idea

Every Houdini SideFX registered gets a card directly below. Activating one fills
**both** paths together: the installation folder and its matching
`houdini<major>.<minor>` documents folder.

<p align="center">
  <img width="900" alt="Houdini installation cards with the install and documents folders they derive" src="screenshots/settings-houdini-install.png" />
  <br>
  <sub><em>Houdini 22.0.368 activated — its installation folder and the matching <code>houdini22.0</code> documents folder, filled together.</em></sub>
</p>

Pairing them is the point: the studio runs Houdini's `hython` with that
documents folder as its preferences directory, and pointed at another version's
it loads the wrong DazToHue assets — or none — leaving every DazToHue node an
unknown type.

> **Documents folder not there yet?** The card says so and stays on offer.
> Houdini creates it on first launch, so start that Houdini once and press
> **Rescan**.

The **extra Houdini folders** list further down is yours and is never touched by
activating — it exists so an older Houdini can keep an older DTH release. A
`houdini…` folder with no Houdini behind it is reported there rather than
dropped; usually an uninstall left it.

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
2. **Where it installs** — your Daz content library. With an installation
   activated above there is no field here at all: the line above the buttons
   names the destination it derives. Press **Install** to copy the release's Daz
   content into the library; **Dry run** previews what would be copied.

   Without an activated installation this is a **My DAZ 3D Library** field you
   fill in yourself (e.g. `…\Documents\DAZ 3D\Studio\My Library`).
3. **Houdini documents folder** *(optional)* — your Houdini user folder
   (e.g. `…\Documents\houdini20.5`). Press its **Install** to merge the
   release's Houdini assets (otls, presets, toolbar) into it. Skip this if
   Houdini isn't on this machine.
4. **Add another Houdini folder** *(optional)* repeats step 3 for a second
   Houdini version: each extra folder installs its release independently, so
   an older Houdini can keep an older DTH release.

## Daz Studio plugins

Two plugins live inside Daz Studio, and the studio installs both — into **every**
Daz Studio it finds on this machine:

- the **DTH Exporter** (mrpdean's), which exports the ROM out of Daz — you point
  the studio at its release folder;
- the **DTH Character Studio Runner** (ships inside the app, nothing to
  download), which lets the studio drive Daz: the
  [**DTH Export** batch](./05-rom-in-daz.md#batch-export--dth-export),
  [**Tools → Scan & index → Scan project**](./tools.md#tab-1--scan-amp-index),
  [**Import from Daz scene**](./05-rom-in-daz.md), and opening scenes in an
  already-running Daz all go through it.

1. **DTH Exporter Plugin release folder(s)** — **Add folder** and pick the
   extracted download. Both Daz Studio 4 and Daz Studio 6 builds are handled: if
   your download holds a folder per version (`ExporterPluginDaz Studio 4` beside
   `ExporterPluginDaz Studio 6`), point at the folder ABOVE them and the studio
   finds both. Keep the versions somewhere else? Add one folder each.

   Which Daz Studio a build is for is read from the DLL itself — Daz Studio 6
   only loads plugins named `dsp_*.dll`, so the name is the answer. The list
   under the field shows what was found, and flags a folder whose name disagrees
   with the DLL inside it.

   <p align="center">
     <img width="900" alt="Daz Studio plugins panel" src="screenshots/settings-daz-plugins.png" />
     <br>
     <sub><em>One release folder, both builds found — and every Daz Studio on the
     machine listed with what it has and what it would get.</em></sub>
   </p>

2. **Installed in** — one row per Daz Studio on the machine, with what each has
   now and what it would get. A Daz Studio with no matching build says so rather
   than being handed the wrong one (a Daz Studio 6 cannot load a Daz Studio 4
   plugin at all).

3. Press **Install / update all**. Only what is pending is copied; when
   everything is current the button becomes **Reinstall all**. Each copy is its
   own line in the report, named after the installation it went into, so one Daz
   needing admin rights while another doesn't reads as exactly that.

   Daz Studio usually sits in an admin-protected folder on `C:` — the app tells
   you when that's the case: close Daz, then reopen DTH Character Studio as
   administrator and install again. **Daz must be closed either way** — a running
   Daz Studio locks its loaded plugin DLLs.

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

   Once the elevated install succeeds, the app offers **Restart normally** —
   take it: while the studio runs as administrator, Windows silently blocks
   drag-and-drop from Explorer into its window (nothing happens, no error).
   The restart reopens your project without elevation and drops work again.

## Save

Press **Save** at the top. The studio scans the release's pose presets — you're
ready to create a project.

## The App Data tab

Settings also has an **App Data** tab — the app's own on-disk state:

- **App data folder** — machine settings, the recent-projects list,
  network-drive mappings and scan outputs (project data lives in each project's
  own folder). The path chip copies it; Alt+click reveals it.
- **Storage & housekeeping** — the studio ages out **its own** generated data
  so it can't fill your disk: **Clean up now** deletes `Scan_Frames` keyframe
  CSVs and any leftover [product-scan](./product-scanning.md) drop files older
  than 30 days, plus **note media no note references anymore** after
  7 days (all three also swept automatically on every launch). Product-scan
  files are normally deleted the moment the studio reads them, so that folder
  is usually empty — the age-out is a safety net for one that was locked.
- **DTH Exporter job file** — the same section can clear a **stuck batch
  handoff**. DTH Export and the scans hand Daz Studio their work through one
  file in your Daz library's `Scripts/DTH-Character-Studio` folder, and if a
  batch never starts (Daz was closed mid-handoff, or the Runner plugin never
  picked it up) that file stays behind — after which every export and scan
  refuses with *"a batch is waiting for Daz Studio"*. The readout names the file
  that's there, how old it is, and whether Daz might still be working through
  it; **Delete job file** removes it. Nothing in Daz is undone — the file is a
  to-do list, not a result.

(Mapped **network drives** the app remembers show as their own pane at the
bottom of the **General** tab, with a "Re-map missing now" action.)

&nbsp;

> [!NOTE]
> **Extras (later):** the **[Tools](./tools.md)** page can also install your
> own Daz assets, custom morphs, and Daz/Houdini presets into the right
> places — none of it is needed for your first character.

&nbsp;

[← Install the app](./01-installation.md) · [Next: Your first project →](./03-first-project.md)
