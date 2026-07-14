# Deep dive: Daz product scanning (optional)

Product scanning answers "**which Daz products does this character actually use?**"
— it generates a small Daz script that analyses the open scene, matches the used
assets to your installed products, and writes a CSV the studio reads back so you can
review and **store the product list on the character** (product name, SKU, artist,
version). Useful for provenance, licensing notes, or rebuilding a character later.

&nbsp;

> [!NOTE]
> It's **opt-in, per project**, and completely optional — it never affects ROM
> generation.

&nbsp;

---

## Enable it

Open **Settings → Project** and turn on **Enable Daz Products**, then Save (stored in
the project's `.dcsp`). With it on:

- each character generates a **`Scan_Products_<Name>.dsa`** script alongside its ROM
  script, and
- the character page gains a **Products** tab.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="Settings → Project → Enable Daz Products" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>Enable Daz Products in Settings → Project.</em></sub>
</p>
-->

## Set the DIM manifests folder (for names, SKUs, artists)

Right below the toggle, set the **DAZ Install Manager manifests folder** — the
`ManifestFiles` folder DIM writes (a folder of `.dsx` files; see DIM → Advanced
Settings → "Download/Install"). The scan reads it to resolve used assets to real
**product names, SKUs and artists**. **Detect installed location** auto-finds it.

- It's a **machine-wide** setting (shared by all projects), even though it sits on
  the Project tab.
- **Leave it empty and the scan still runs** — it just lists the used assets without
  naming products. A reminder appears on the Products tab when it's unset.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="DIM manifests folder field + Detect button" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The DIM manifests folder field with its Detect button.</em></sub>
</p>
-->

---

## Run a scan

1. In the studio, **Save** the character (generates/updates its scan script).
2. Open the character's **scene in Daz Studio**.
3. In Daz's Content Library, run **`Scan_Products_<Name>`** (installed beside the ROM
   script under `Scripts/DTH-Character-Studio/<Project>/<Character>/`).
4. It analyses the **currently-open** scene and writes a CSV named after that scene.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="running the scan in Daz" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>Running the product scan on the open scene in Daz.</em></sub>
</p>
-->

&nbsp;

> [!NOTE]
> **Per-scene by design.** The CSV is named after the open scene, so scanning an
> outfit variant, a different look, etc. produces **separate** CSVs that don't
> overwrite each other — run the script once per scene you want covered, and the
> studio merges them, attributing each product to the scene(s) it appeared in.

&nbsp;

Behind the scenes it matches assets strongest-first: the file the asset came from →
its textures' folder → SKU → product keywords → known third-party products (e.g.
Golden Palace) → Genesis base essentials, with a content-library fallback for manual
installs that have no DIM manifest. Scans are stored under the app's data folder,
keyed to the project + character, and **age out after 30 days** (and are removed when
you delete the character) — see [Storage & housekeeping](./tools.md).

---

## Review results (Products tab)

Switch to the character's **Products** tab. **Check for scan results** re-reads the
CSVs from disk.

<!-- SCREENSHOT — paste the image URL into src below, then delete this comment line and the closing one
<p align="center">
  <img width="900" alt="Products tab, matched products table" src="ADD_IMAGE_URL" />
  <br>
  <sub><em>The matched products table on the character's Products tab.</em></sub>
</p>
-->

- **Matched products** — a table of **Product · Used as · SKU · Artist · Version ·
  Match** (with a per-scene filter when a character has several scanned scenes).
  Expand a row to see the exact assets behind the match. When the SKU is a Daz store
  id, the product name links to its Daz **product page**.
- **Store on character** — writes the current product list onto the character's
  definition (no script regeneration). A banner tells you when a newer scan on disk
  differs from what's stored, with **Update stored products** to re-sync.
- **Unmatched** — a collapsible list of assets the scan couldn't tie to a product
  (still shown with artist/version from their own files). Common when the DIM folder
  is unset or for hand-installed content.
- **Clear** — discards the on-disk scan CSVs for this character (your *stored*
  products stay on the character).

## Gotchas

- **Naming needs the DIM folder.** Without it, everything lists as unmatched (the
  scan still works, just unnamed).
- **Per-scene.** Cover every outfit/look by opening each scene and re-running.
- **Stored ≠ scanned.** Storing snapshots the current scan onto the character; later
  scans can drift until you re-store (the amber banner flags it).
- The DIM folder is machine-wide — changing it affects every project.

[← Guide overview](./README.md)
