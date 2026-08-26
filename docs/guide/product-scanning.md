# Daz product scanning

Product scanning answers "**which Daz products does this character actually use?**"
— the studio analyses each scene as it exports it, matches the used assets to your
installed products, and files the result (product name, SKU, artist, version)
against the character. It runs on its own and never affects ROM generation.

## Set the DIM manifests folder — that's the switch

**Usually already done.** Activating a Daz installation in
[Settings → General](./02-setup.md#daz-installation--pick-it-once) fills this from
DIM's own settings. Otherwise set the **DAZ Install Manager manifests folder** in
**Settings** — the `ManifestFiles` folder DIM writes (see DIM → Advanced Settings →
"Download/Install"); **Detect installed location** auto-finds it. More than one
DIM library? Add the others with **Add another manifests folder**, right under the
primary field — the scan reads them all.

That folder **is** the product database, so it also arms the scanning: with it set,
every export run scans the scene it just built. With it empty, nothing is scanned.
It's a **machine-wide** setting, shared by all projects.

<p align="center">
  <img width="900" alt="DIM manifests folder field + Detect button" src="screenshots/settings-dim-manifests.png" />
  <br>
  <sub><em>The DIM manifests folder field with its Detect button.</em></sub>
</p>

## Show the Products tab (per project)

**Settings → Project → Show the Daz Products tab** decides whether this project's
characters get a **Products** tab. It does *not* decide whether scanning happens —
every export run scans either way, so turning the tab on later shows results
already collected. It does also switch off the two things you would start by hand:
the per-character `Scan_Products_<Name>` script and the product pass in Tools →
Scan project.

<p align="center">
  <img width="900" alt="Settings → Project → Show the Daz Products tab" src="screenshots/settings-daz-products.png" />
  <br>
  <sub><em>The tab toggle in Settings → Project.</em></sub>
</p>

## When a scan happens

- **Every ROM/export run** scans the scene it just built.
- [**Tools → Scan & index → Scan project**](./tools.md#tab-1--scan-amp-index)
  covers every scene of every character in one unattended batch.
- **By hand**, for a one-off scene: open it in Daz Studio and run
  **`Scan_Products_<Name>`** from the Content Library (installed beside the ROM
  script). The studio picks the result up next time you open the character — or
  press **Check for new results** on the Products tab.

> [!NOTE]
> **Per-scene by design.** Each scene is filed separately and a re-scan replaces
> only that scene's entry, so scanning one outfit never disturbs the products you
> mapped for the others. The tab shows them merged.

Matching tries the strongest signals first — the asset's own file, its textures,
SKU, product keywords — falling back to a content-library match for manual installs
without a DIM manifest (that's the **Match** column). The scan looks in every
content directory Daz has mapped, and recognises morphs installed under the
figure's own `Morphs/<Vendor>/<Product>` folder.

Results are stored in the project's hidden
`.dcsmeta/characters/<Character>/products.json`, so they travel with the project
and go when you delete the character. The Daz-written CSVs are transport only:
parsed and deleted the moment the studio picks them up.

## Read the results (Products tab)

<p align="center">
  <img width="900" alt="Products tab, matched products table" src="screenshots/products-tab.png" />
  <br>
  <sub><em>The matched products table on the character's Products tab.</em></sub>
</p>

- **Scanned scenes** — one row per scene, with its counts and when it was last
  scanned. The panel below is these merged.
- **Matched products** — **Product · Used as · SKU · Artist · Version · Match**,
  with a per-scene filter. Expand a row for the exact assets behind the match; a
  Daz store SKU links the name to its **product page**.
- **Unmatched** — assets the scan couldn't tie to a product, still shown with
  artist/version from their own files. Common for hand-installed content, which
  matches by content-library folder instead and so has no SKU.
- **Check for new results** — re-reads, picking up anything a manual Daz run left
  behind. **Clear** throws the stored results away; the next export rebuilds them.

[← Guide overview](./README.md)
