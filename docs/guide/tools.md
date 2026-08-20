# The Tools page

The **Tools** page (top-right) keeps the studio's morph index fresh, installs *your
own* Daz / Houdini content, and keeps generated files in sync. **Everything here is
optional.**

<p align="center">
  <img width="900" alt="Tools page tabs" src="screenshots/tools-page.png" />
  <br>
  <sub><em>The Tools page and its tabs.</em></sub>
</p>

> [!NOTE]
> Everything the Daz side needs ships **with the studio** — the runtime and the
> visible scripts (`Build_Genesis_Index`, `Scan_Frames`,
> [`Fix_Graft_Shell_Surfaces`](./bundled-scripts.md#geografts-under-a-golden-palace--dicktator-shell),
> [`Kill_Animation`](./bundled-scripts.md#rescuing-an-old-scene-that-is-only-a-rom-animation))
> install into `Scripts/DTH-Character-Studio` automatically on Save / Refresh
> assets. There is no separate scripts download.

---

## Tab 1 — Scan & index

The morph and bone index behind the editor's autocompletes, and the per-scene scans
that extend it. Tick what you want, press **Start scan**, and leave it. The batch
goes through the [**Runner plugin**](./02-setup.md#daz-studio-plugins), so Start
stays off until the Runner is installed and **My DAZ 3D Library** is set in
[Settings](./02-setup.md).

<p align="center">
  <img width="900" alt="The Scan project panel on the Scan &amp; index tab" src="screenshots/tools-scan-index.png" />
  <br>
  <sub><em>The Scan project panel: tick the passes, press Start scan, leave it.</em></sub>
</p>

- **Base morphs** — builds each generation's stock figures and indexes their morphs
  and bones (exactly what
  [`Build_Genesis_Index`](./custom-morphs.md#finding-the-internal-daz-name)
  does). One job, and it runs **first**, because the scene scans filter themselves
  against it.
- **Character morphs** — opens every linked Daz scene and indexes the dials the base
  index *doesn't* have: fitted clothing, hair, third-party geografts. One job per
  scene. It **needs** the base index of its generation, so with none it stops and
  says so.
- **Products** — runs the [Daz Products scan](./product-scanning.md) for the same
  scenes, once a **DAZ Install Manager manifests folder** is set. It shares the
  scene opens with the morph scan, so ticking both costs no extra time.

**Scenes to scan** — the scene passes default to every linked scene, but each one
is a full Daz open, so a big project is a long run. Expand the list to tick exactly
what you want (per scene, or a whole character at once); the job count updates as
you pick. Scenes whose `.duf` is missing are struck through and never enqueued.

<p align="center">
  <img width="900" alt="The Scenes to scan picker expanded — per-character tri-state and one card per scene" src="screenshots/tools-scan-scenes.png" />
  <br>
  <sub><em>The expanded scene picker: a tri-state box per character, a card per scene.</em></sub>
</p>

A Daz the studio has to start for the scan starts **minimized**; one you already
had open is left where it is. While the batch is still waiting to be picked up you
can **Abort** it. From the **Home** window (no project open) the scene passes are
disabled and **Base morphs** runs on its own.

> [!NOTE]
> **Scene morphs are scoped to their scene.** Two outfits in two scenes both have an
> *Expand All* dial, so a scene-scanned morph is only suggested while **that** scene
> is selected, marked with a small **this scene** badge. Morphs the base figure
> carries are always offered, and re-scanning a scene *replaces* what it
> contributed. You rarely have to re-run this by hand: every ROM/export run re-scans
> the scene it just built.

---

## Tab 2 — Daz Studio & Houdini

Install your **own** Daz / Houdini content (not DTH release data). Each section
remembers its folders in Settings and installs from them on demand. **Dry run**
everywhere previews without writing.

### Daz assets

Point it at your **asset source folders** (`.zip`s are extracted). Each asset's
content (`data` / `People` / `Runtime` / `Documentation`) installs into "My DAZ 3D
Library", **skipping what's already there**. When two products ship the same file,
**newer Genesis wins** (by folder name), then the **bigger file**. **Scan** lists
what's found; **Install** copies only what changed.

<p align="center">
  <img width="900" alt="Daz assets install section" src="screenshots/tools-daz-assets.png" />
  <br>
  <sub><em>The Daz assets install section.</em></sub>
</p>

### Deduplicate

Finds **duplicate assets** (a folder and its identical `.zip`, or the same product
at two versions) and **conflicting shared files** (the same file shipped by two
products at different sizes). **Scan** previews; nothing changes until you
**Apply**, and Apply only **quarantines** — it *moves* the redundant copies to a
**Quarantine folder** you set, so it's reversible. Pick one *outside* your asset
sources.

Shared-file conflicts are **never rewritten** — that would edit an author's
download. You **Accept** them instead, which tells the scan they're legitimately
shared. Wrapper downloads (a zip inside a zip) are looked inside automatically.

<p align="center">
  <img width="900" alt="Deduplicate section" src="screenshots/tools-deduplicate.png" />
  <br>
  <sub><em>The Deduplicate section for redundant and conflicting assets.</em></sub>
</p>

### Custom morphs · Daz presets

Two **merge-only** installs (add new files, never overwrite your edits): custom
morphs made with Daz's Transfer Shape Utility, and your Daz presets.

### Houdini presets

Merges your Houdini `my_presets` into your Houdini documents folder and wires it
into that version's `houdini.env` (`SHARED_PRESETS` + `HOUDINI_PATH`).

### Danger zone

> [!CAUTION]
> After you uninstall Daz Studio / DIM via Windows "Add or remove programs",
> leftover folders remain. This **permanently deletes** each listed folder
> recursively. Use **Prefill folder paths** to add the standard Daz locations, edit
> the list, and **always Dry run first**. As a safety rail the studio refuses to
> delete a drive/profile root or any folder that isn't Daz-owned.

<p align="center">
  <img width="900" alt="Danger zone" src="screenshots/tools-danger-zone.png" />
  <br>
  <sub><em>The Danger zone for removing leftover Daz folders.</em></sub>
</p>

---

## Tab 3 — Refresh assets

Re-generates the Daz scripts and PoseAsset CSVs so every generated file matches the
**current** studio/runtime version, migrating older definitions first (your ROM
content is preserved). Run it after **updating the app** or **switching DTH
release**. It covers **every known (recent) project**, no matter which window you
run it from; problems per character are listed inline, and the button pulses orange
when a refresh is due. **Ctrl+click Refresh** also rebuilds every character's
stored **avatar** from its pristine source.

The detection table compares three versions, Local (your files) vs App (what this
studio generates):

| Version | Governs |
| --- | --- |
| **DTH Version** | the Houdini **PoseAsset CSV**, the only artifact tied to the DTH release. Pinned to the release's CSV *era*, so a non-breaking update (2.4.3 → 2.4.4) stays current; only a release that changes the CSV format marks it out of date. |
| **Character Schema Version** | the **character definition** (its `.json`). A newer version means the stored shape changed: the definition is migrated and re-saved, and its scripts and CSV regenerated with it. |
| **Script Runtime Version** | the generated **Daz scripts** and the shared **DTH runtime files**. A newer version means the runtime's call API changed, so the runtime files are reinstalled and every character's scripts regenerated. |

<p align="center">
  <img width="900" alt="Refresh assets tab" src="screenshots/tools-refresh.png" />
  <br>
  <sub><em>The Refresh assets tab.</em></sub>
</p>

### …and the Houdini half

A refresh only fixes the Daz end. Your `.hip` files keep the DazToHue asset
definitions they were built with, so a new DazToHue release leaves every project on
the old ones until DazToHue's own **Refresh Assets** runs inside each of them.

So when the studio notices the DazToHue release has **changed since it last looked**,
the refresh offers to do that too — across every linked Houdini project at once,
through `hython`, without you opening Houdini. It needs the **Houdini installation
folder** and its matching documents folder in Settings; without them the offer stays
away.

What it can and can't say, which is the same short list as the
[per-project button](./houdini-project-checks.md#refresh-assets):

- **It still isn't a check.** Nothing in a project says which DazToHue release its
  assets came from. What the studio remembers is only which projects *it* has run
  this on, and under which release — so a project reads as *"never refreshed by the
  studio"* rather than as out of date.
- **Already done is skipped.** A project refreshed under the release that's active
  now isn't offered again.
- **A failed project comes back.** If any project fails, the release stays
  outstanding and the next refresh re-offers exactly the ones that didn't get
  done — so fixing the cause (usually DazToHue not installed for the Houdini
  version the studio points at) and refreshing again picks up where it left off.
- **Dismissing costs nothing.** *Not now* writes nothing; the offer returns on your
  next refresh.

Every project is copied into its `backup/` folder before it's saved, and each saved
project keeps an **Undo this run** button in the report — the way back if you ever
need one project on the previous DazToHue release. It's **one rolling copy per
project**, so the next run of this replaces it. Close the projects in Houdini first:
Houdini writes the whole scene on save and would overwrite the result.

[← Guide overview](./README.md)
