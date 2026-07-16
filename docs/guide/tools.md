# Deep dive: the Tools page

The **Tools** page (top-right) is where you install and maintain *your own* Daz /
Houdini content and keep the studio's generated files in sync. **Everything here
is optional** — you never need it to define a character and generate its ROM.
The [one-time setup](./02-setup.md) covered installing the DTH release + Exporter;
Tools is for the extras beyond that.

It has two tabs.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="Tools page, two tabs" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The Tools page and its two tabs.</em></sub>
</p>
-->

&nbsp;

> [!NOTE]
> Everything the Daz side needs ships **with the studio** — the runtime and the
> visible scan scripts (`Scan_Morphs_<Genesis>`, `Scan_Frames`) install into
> `Scripts/DTH-Character-Studio` automatically on Save / Refresh assets. There is
> no separate scripts download anymore.

&nbsp;

---

## Tab 1 — Daz Studio & Houdini

Install your **own** Daz / Houdini content (not DTH release data). Each section
remembers its folders in Settings and installs from them on demand. **Dry run**
everywhere previews without writing.

### Daz assets

Point it at your **asset source folders** (e.g. per-Genesis download folders;
`.zip`s are extracted). Each asset's content (`data` / `People` / `Runtime` /
`Documentation`) installs into "My DAZ 3D Library", **skipping what's already
there**. When two products ship the same file, the winner is picked automatically:
**newer Genesis wins** (by folder name, e.g. `_genesis 9` over `_genesis 8`), then
the **bigger file** — so only the winning copy installs. **Scan** lists what's
found; **Install** copies only what changed.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="Daz assets install section" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The Daz assets install section.</em></sub>
</p>
-->

### Deduplicate

Finds **duplicate assets** (a folder and its identical `.zip`, or the same product
at two versions) and **conflicting shared files** (the same file shipped by two
products at different sizes). **Scan** previews; nothing changes until you
**Apply**. Apply only **quarantines** the redundant copies — it *moves* them to a
**Quarantine folder** you set (reversible; pick one *outside* your asset sources).
Shared-file conflicts are **never rewritten** (that would edit an author's
download) — you **Accept** them instead, which tells the scan they're legitimately
shared. See also the [nested-zip handling](./tools.md) for store "wrapper"
downloads (a zip inside a zip) — the scan looks inside them automatically.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="Deduplicate section" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The Deduplicate section for redundant and conflicting assets.</em></sub>
</p>
-->

### Storage & housekeeping

The studio ages out **its own** generated data so it can't fill your disk:

- **Clean up now** — deletes per-scene [product-scan](./product-scanning.md) files
  and `Scan_Frames` keyframe CSVs older than 30 days (also swept automatically on
  every launch) and reports how much it freed.
- **Empty quarantine** — shows the dedup quarantine's size and lets you reclaim it
  with a confirm. Never emptied automatically — it's your reversible backup.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="Storage &amp; housekeeping section" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The Storage &amp; housekeeping section.</em></sub>
</p>
-->

### Custom morphs · Daz presets

Two **merge-only** installs (add new files, never overwrite your edits): custom
morphs made with Daz's Transfer Shape Utility (source → your library's
`data/Daz 3D`), and your Daz presets.

### Houdini presets

Merges your Houdini `my_presets` into your Houdini documents folder and wires it
into that version's `houdini.env` (`SHARED_PRESETS` + `HOUDINI_PATH`).

### Danger zone

&nbsp;

> [!CAUTION]
> After you uninstall Daz Studio / DIM via Windows "Add or remove programs", leftover
> folders remain. This **permanently deletes** each listed folder recursively. Use
> **Prefill folder paths** to add the standard Daz locations, edit the list, and
> **always Dry run first**. As a safety rail the studio refuses to delete a
> drive/profile root or any folder that isn't Daz-owned.

&nbsp;

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="Danger zone" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The Danger zone for removing leftover Daz folders.</em></sub>
</p>
-->

---

## Tab 2 — Refresh assets

Re-generates the Daz scripts and PoseAsset CSVs so every generated file matches the
**current** studio/runtime version. Run it after **updating the app** or
**switching DTH release**. It always covers **every known (recent) project**, no
matter which window you run it from. **Your character definitions are never
changed** — only their generated output. Problems per character are listed inline;
the button pulses orange when a refresh is due.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="Refresh assets tab" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The Refresh assets tab.</em></sub>
</p>
-->

[← Guide overview](./README.md)
