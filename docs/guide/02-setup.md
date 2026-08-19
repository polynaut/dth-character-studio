# 2 · One-time setup

Open **Settings** (top right) → **General**. Four things get wired up: your **Daz
installation**, your **Houdini installation**, the **DTH release** (the content
your ROMs are built from) and the **Daz Studio plugins**. The last two come from
your [DazToHue](https://www.artstation.com/marketplace/p/BLM5K/daztohue) purchase
— extract the downloaded archives somewhere permanent first.

The two installations are usually already done for you: the tab opens with every
Daz Studio and every Houdini on the machine listed as a card. Click the one you
want and its paths are filled in and saved.

<p align="center">
  <img width="900" alt="Settings → General with a Daz Studio and a Houdini installation card activated" src="screenshots/settings-installations.png" />
  <br>
  <sub><em>Both detections, each with a card activated: DAZ Studio 6 and Houdini 22.0.368, with the paths they derive shown read-only beneath.</em></sub>
</p>

## Daz installation — pick it once

Every Daz Studio the **DAZ Install Manager** has installed appears as a card at
the top of **Settings → General**. Click one to **activate** it — three paths are
filled and saved on the spot, no Save to press:

| Path | Where it comes from |
| --- | --- |
| **My DAZ 3D Library** | the library DIM currently installs into |
| **Daz Studio install folder** | that card's own install folder |
| **DIM product database** | DIM's manifests folder (see [Product scanning](./product-scanning.md)) |

<p align="center">
  <img width="900" alt="Daz installation cards with the derived read-only paths" src="screenshots/settings-daz-install.png" />
  <br>
  <sub><em>Both Daz Studios found; DAZ Studio 6 activated, and the paths it derives shown read-only. The older card carries the <strong>Export only</strong> switch described below.</em></sub>
</p>

They stay read-only while an installation is active and follow DIM: move your
library later and opening Settings picks it up. Switching cards changes only the
install folder — the other two belong to DIM, not to one Studio version. **No DIM?**
The section says so and the three paths stay ordinary editable fields, as does
**Set the paths manually** after activating.

### Export only — run the batch in an older Daz Studio

Skip this unless you have **two** Daz Studios installed. The
[DTH Export batch](./dth-export.md) needs the **Runner plugin**, which is built
against one Studio major version — so a brand-new Daz Studio can leave you unable
to export until a Runner build catches up.

With the newest installation active, each **older** card that can still run a batch
carries an **Export only** switch: DTH Export then runs its batch **in that
installation**, while everything else keeps using the active one. Only one
installation can carry it, and the Runner is installed into whichever one it is. If
that installation later disappears, Settings offers to send exports back to the
active one. **Daz Studio 4 can carry it**, but needs **Exporter 2.0.2.0** or newer;
with an older one a DS4 batch opens every scene and exports nothing.

> [!NOTE]
> Don't confuse this with the **Export only** *mode* inside the
> [DTH Export panel](./dth-export.md). That one decides *what* a batch does; this
> switch decides *which Daz Studio* runs it.

## Houdini installation — same idea

Every Houdini SideFX registered gets a card directly below. Activating one fills
**both** paths together: the installation folder and its matching
`houdini<major>.<minor>` documents folder.

<p align="center">
  <img width="900" alt="Houdini installation cards with the install and documents folders they derive" src="screenshots/settings-houdini-install.png" />
  <br>
  <sub><em>Houdini 22.0.368 activated — its installation folder and the matching <code>houdini22.0</code> documents folder, filled together.</em></sub>
</p>

Pairing them is the point: the studio runs Houdini's `hython` with that documents
folder as its preferences directory. Pointed at another version's, it loads the
wrong DazToHue assets — or none — leaving every DazToHue node an unknown type.

> **Documents folder not there yet?** Houdini creates it on first launch. Start
> that Houdini once and press **Rescan**.

The **extra Houdini folders** list further down is yours and is never touched by
activating — it exists so an older Houdini can keep an older DTH release.

## Unreal Engine — detected, nothing to pick

Every Unreal Engine the Epic Games launcher has installed is listed below. There is
**nothing to activate**: each linked `.uproject` names its own engine version, and
the studio matches DTH content and plugins to it per project. An engine whose
folder is gone is flagged rather than hidden.

## Setup DTH Release

<p align="center">
  <img width="900" alt="settings general, DTH release section" src="screenshots/settings-dth-release.png" />
  <br>
  <sub><em>The DTH release section in Settings → General — one release, and the destinations it installs into.</em></sub>
</p>

Pick the release first; everything below it is a **destination**.

1. **DTH release(s) folder** — point it at the extracted release, or at a folder
   holding several versions, then pick the **active** one in the dropdown. A
   release added later must be selected (and installed) yourself.
2. **Where it installs** — your Daz content library. With an installation activated
   above, the line over the buttons names the destination; otherwise fill in **My
   DAZ 3D Library** yourself. **Install** copies; **Dry run** previews.
3. **Houdini documents folder** *(optional)* — its **Install** merges the release's
   Houdini assets. **Add another Houdini folder** repeats this for a second Houdini
   version, so an older one can keep an older DTH release (offered only while the
   Houdini paths are yours to edit).

## Daz Studio plugins

Two plugins live inside Daz Studio, and the studio installs both into **every**
Daz Studio it finds:

- the **DTH Exporter** (mrpdean's), which exports the ROM out of Daz — you point
  the studio at its release folder;
- the **DTH Character Studio Runner** (ships inside the app), which lets the
  studio drive Daz: the [DTH Export batch](./dth-export.md),
  [Tools → Scan & index](./tools.md#tab-1--scan-amp-index),
  [Import from Daz scene](./05-rom-in-daz.md), and opening scenes in a running Daz.

1. **DTH Exporter Plugin release folder(s)** — **Add folder** and pick the
   extracted download. If it holds a folder per version (`ExporterPluginDaz
   Studio 4` beside `ExporterPluginDaz Studio 6`), point at the folder ABOVE them.
   Which Studio a build is for is read from the DLL itself, and the list flags a
   folder whose name disagrees with the DLL inside it.

   <p align="center">
     <img width="900" alt="Daz Studio plugins panel" src="screenshots/settings-daz-plugins.png" />
     <br>
     <sub><em>One release folder, both builds found — and every Daz Studio on the
     machine listed with what it has and what it would get.</em></sub>
   </p>

2. **Installed in** — one row per Daz Studio, with what each has now and what it
   would get. A Daz Studio with no matching build says so rather than being handed
   the wrong one.

3. Press **Install / update all**. Only what is pending is copied; when everything
   is current the button becomes **Reinstall all**.

   **Daz must be closed** — a running Daz Studio locks its loaded plugin DLLs,
   and administrator rights do nothing for that; close every Daz Studio window
   and install again.

   **Daz in a protected folder?** Daz usually sits under `Program Files` on `C:`.
   When the copy needs administrator rights, the panel says so and offers
   **Install with administrator rights** — the studio borrows them for that copy
   alone: one Windows permission prompt, no restart, and the app window stays
   unelevated, so drag-and-drop and your mapped network drives keep working.

## Unreal Engine Plugins

Where the studio looks for **Unreal Engine plugins** to offer when installing into
a linked Unreal project. A folder can be a **plugin itself** (its `.uplugin` at the
top), a **folder of plugins**, or a **multi-build root** with one subfolder per
engine version. A plugin shipped as a **`.zip`** counts too — the studio reads
inside it and extracts at install time, so leave it zipped.

Under each folder the panel previews what was recognized and which engine version
each build was matched to — a version in its path (deepest wins), falling back to
the `.uplugin`'s `EngineVersion`; no version anywhere means it is offered for every
engine. A number that could not be an engine version is skipped rather than
believed: in `KawaiiPhysics_5.7_1.21.0` only `5.7` is one.

Nothing installs from here — the install dialog on a project's Unreal card does
that, per project. See
[Linking Unreal projects](./03-first-project.md#linking-unreal-projects).

> **A name is a label; the binaries are the truth.** A built plugin carries a
> **`BuildId`**, and Unreal refuses to load one whose id differs from the engine's.
> The install dialog checks it, marks a mismatch **built for another engine build**
> and leaves it unchecked — and it also decides which build you are offered when
> two look alike.

## Save

Press **Save** at the top. The studio scans the release's pose presets — you're
ready to create a project.

## The App Data tab

The app's own on-disk state:

- **App data folder** — machine settings, the recent-projects list, network-drive
  mappings and scan outputs. (Project data lives in each project's own folder.)
- **Storage & housekeeping** — **Clean up now** deletes `Scan_Frames` keyframe
  CSVs and leftover [product-scan](./product-scanning.md) drop files older than 30
  days, plus unreferenced note media after 7 days. All three are also swept on
  every launch.
- **DTH Exporter job file** — clears a **stuck batch handoff**. DTH Export and the
  scans hand Daz their work through one file in your Daz library; if a batch never
  starts, that file stays behind and every export and scan refuses with *"a batch
  is waiting for Daz Studio"*. **Delete job file** removes it — nothing in Daz is
  undone, since the file is a to-do list, not a result.

Mapped **network drives** the app remembers get their own pane at the bottom of the
**General** tab, with a "Re-map missing now" action.

> [!NOTE]
> **Extras (later):** the **[Tools](./tools.md)** page can also install your own Daz
> assets, custom morphs, and Daz/Houdini presets — none of it is needed for your
> first character.

[← Install the app](./01-installation.md) · [Next: Your first project →](./03-first-project.md)
