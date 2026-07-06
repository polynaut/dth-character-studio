# Deep dive: the Tools page

The **Tools** page (top-right) is where you install and maintain *your own* Daz /
Houdini content and keep the studio's generated files in sync. **Everything here
is optional** — you never need it to define a character and generate its ROM.
The [one-time setup](./02-setup.md) covered installing the DTH release + Exporter;
Tools is for the extras beyond that.

It has three tabs.

<!-- screenshot: Tools page, three tabs -->

> **Two different things called "Daz assets".** On this page, the **Daz assets**
> *section* (in the *Daz Studio & Houdini* tab) installs your **downloaded Daz
> products** into your library. That is **not** the same as the optional per-project
> **Assets** feature (reusable scenes attached to a project) — see
> [Daz assets](./daz-assets.md) for that. Same words, different features.

---

## Tab 1 — DazToHue-Scripts

Downloads mrpdean/soltude's **[DazToHue-Scripts](https://github.com/soltude/DazToHue-Scripts)**
(the Daz-side scripts the studio builds on) and installs them into
`<My DAZ 3D Library>/Scripts/DazToHue-Scripts`. It shows whether your installed
copy is up to date with the latest commit, with **Dry run** / **Install** buttons.

The main reason to install it: it ships **`DthScanFrames.dsa`**. Run that in Daz on
an open scene and it writes a CSV of *every* morph on the figure — then a ROM
section's **Import from CSV** (in the character editor) pulls that morph list
straight into the character, so you don't type morph names by hand.

<!-- screenshot: DazToHue-Scripts tab -->

---

## Tab 2 — Daz Studio & Houdini

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
found; **Install** copies only what changed. *(This is the "install my downloads"
feature — not the project Assets feature.)*

<!-- screenshot: Daz assets install section -->

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

<!-- screenshot: Deduplicate section -->

### Storage & housekeeping

The studio ages out **its own** generated data so it can't fill your disk:

- **Clean up now** — deletes per-scene [product-scan](./product-scanning.md) files
  older than 30 days (also swept automatically on every launch) and reports how
  much it freed.
- **Empty quarantine** — shows the dedup quarantine's size and lets you reclaim it
  with a confirm. Never emptied automatically — it's your reversible backup.

<!-- screenshot: Storage & housekeeping section -->

### Custom morphs · Daz presets

Two **merge-only** installs (add new files, never overwrite your edits): custom
morphs made with Daz's Transfer Shape Utility (source → your library's
`data/Daz 3D`), and your Daz presets.

### Houdini presets

Merges your Houdini `my_presets` into your Houdini documents folder and wires it
into that version's `houdini.env` (`SHARED_PRESETS` + `HOUDINI_PATH`).

### Danger zone

After you uninstall Daz Studio / DIM via Windows "Add or remove programs", leftover
folders remain. This **permanently deletes** each listed folder recursively. Use
**Prefill folder paths** to add the standard Daz locations, edit the list, and
**always Dry run first**. As a safety rail the studio refuses to delete a
drive/profile root or any folder that isn't Daz-owned.

<!-- screenshot: Danger zone -->

---

## Tab 3 — Refresh assets

Re-generates the Daz scripts and PoseAsset CSVs so every generated file matches the
**current** studio/runtime version. Run it after **updating the app** or
**switching DTH release**. From a project window it covers that project; from the
Home window it covers every recent project. **Your character definitions are never
changed** — only their generated output. Problems per character are listed inline;
the button pulses orange when a refresh is due.

<!-- screenshot: Refresh assets tab -->

[← Guide overview](./README.md)
