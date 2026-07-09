import { Fragment, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { Check, ChevronDown, ChevronRight, ExternalLink, RefreshCw, Save } from 'lucide-react'
import { toast } from 'sonner'

import { PathCode } from '#/components/path-code.tsx'
import { Button, InfoPopup } from '@dth/ui'
import { clearProductScan, fetchProductScan, saveCharacter } from '#/lib/rom/api.ts'
import { openExternal } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { characterSlug } from '@dth/rom'

import type { Character } from '@dth/rom'

/**
 * Daz readme page for a DIM product SKU ("86958-1" → store id `86958`). It resolves
 * by SKU, names the product, and links to its store page — the only SKU-keyed Daz
 * URL that reliably maps to a product. Returns '' when the SKU isn't a numeric DIM
 * store id (LOCAL_USER / third-party products carry none → no link).
 */
function dazProductUrl(sku: string): string {
  const id = (sku || '').split('-')[0]?.trim() ?? ''
  return /^\d+$/.test(id) ? `https://docs.daz3d.com/doku.php/public/read_me/index/${id}/start` : ''
}

/**
 * The character editor's "Products" tab body: the per-scene scan files on disk
 * plus the merged "Matched products" review panel. The tab owns its view state
 * (scene filter, expanded rows) and the store/clear actions; storing hands the
 * saved character back to the route via `onStored`.
 */
export function CharacterProductsTab({
  projectId,
  character,
  productScan,
  dimManifestsFolder,
  scriptsAbs,
  scriptsLib,
  scriptsSuffix,
  onStored,
}: {
  projectId: string
  character: Character
  /** The character's product scan as loaded by the route (`fetchProductScan`). */
  productScan: Awaited<ReturnType<typeof fetchProductScan>> | null
  /** settings.dimManifestsFolder — empty shows the "set it in Settings" notice. */
  dimManifestsFolder: string
  /** Where the generated scripts land in the Daz library ('' until it's set),
   *  split into the dimmed library root + the emphasized remainder. */
  scriptsAbs: string
  scriptsLib: string
  scriptsSuffix: string
  /** Receives the saved character after the scan is stored on it. */
  onStored: (saved: Character) => void
}) {
  const router = useRouter()
  const [storingProducts, setStoringProducts] = useState(false)
  const [clearingScan, setClearingScan] = useState(false)
  // Keyed by a stable product id (sku||name, lowercased) — not the row index — so
  // a row stays expanded when the scene filter changes the visible rows.
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(() => new Set())
  // The Products view can be scoped to one scene; null = all scenes (merged).
  const [sceneFilter, setSceneFilter] = useState<string | null>(null)

  // Store the most recent product scan onto the character. Products don't affect
  // generated scripts, so this just persists the draft + the scan fields — no
  // regeneration. Merges into the current draft so any in-progress edits are kept.
  async function storeProducts() {
    if (!productScan?.scan) return
    setStoringProducts(true)
    try {
      const next: Character = {
        ...character,
        products: productScan.scan.products,
        productsUnmatched: productScan.scan.unmatched,
        productsScannedAt: new Date().toISOString(),
      }
      const saved = await saveCharacter({ data: { projectId, character: next } })
      onStored(saved)
      void router.invalidate()
      toast.success(
        `Stored ${saved.products.length} product${saved.products.length === 1 ? '' : 's'} on “${saved.name}”`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setStoringProducts(false)
    }
  }

  // Discard the unstored scan results (the per-scene CSVs) so the review panel
  // clears. Leaves any products already stored on the character untouched.
  async function clearScan() {
    if (!productScan?.exists) return
    setClearingScan(true)
    try {
      await clearProductScan({ data: { projectId, id: character.id } })
      setExpandedProducts(new Set())
      void router.invalidate()
      toast.success('Cleared scan results')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setClearingScan(false)
    }
  }

  // Product scan view: either the full merged set (all scenes) or one scene's
  // slice. A merged record carries the `scenes` it was found in, so filtering is
  // just "does this record include the selected scene". When scoped to a single
  // scene the Scene(s) column is redundant, so `multiScene` drops it.
  const mergedScan = productScan?.scan ?? null
  const scanScenes = mergedScan?.scenes ?? []
  const sceneFilterActive = sceneFilter != null && scanScenes.includes(sceneFilter)
  const viewProducts = !mergedScan
    ? []
    : sceneFilterActive
      ? mergedScan.products.filter((p) => p.scenes.includes(sceneFilter!))
      : mergedScan.products
  const viewUnmatched = !mergedScan
    ? []
    : sceneFilterActive
      ? mergedScan.unmatched.filter((a) => a.scenes.includes(sceneFilter!))
      : mergedScan.unmatched
  const multiScene = scanScenes.length > 1 && !sceneFilterActive
  // The per-scene CSV files on disk, and whether the products stored on the
  // character still reflect them: "up to date" when something is stored and no
  // CSV is newer than the last store (ISO mtimes compare lexicographically). This
  // is why the store button can sit idle even though scan files are still present.
  const scanFiles = productScan?.files ?? []
  const newestScanMtime = scanFiles.reduce((max, f) => (f.modifiedAt > max ? f.modifiedAt : max), '')
  const scanUpToDate =
    !!mergedScan &&
    character.products.length > 0 &&
    !!character.productsScannedAt &&
    newestScanMtime !== '' &&
    newestScanMtime <= character.productsScannedAt
  const sceneChipClass = (active: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
      active
        ? 'border-primary/60 bg-primary/10 text-foreground'
        : 'border-border bg-muted/50 text-muted-foreground hover:text-foreground'
    }`

  return (
    <>
      <section className="mb-8 rounded-lg border bg-card p-5">
        <h2 className="mb-3 flex w-fit items-center gap-1 text-xl font-semibold">
          Daz Products
          <InfoPopup label="Daz Products — more information">
            Open this character's scene in Daz and run the generated{' '}
            <code>Scan_Products_{characterSlug(character)}.dsa</code>. It analyses the open scene,
            matches the used assets to your installed products, and writes a CSV the studio reads
            back here — review the results below and store them on the character.
          </InfoPopup>
        </h2>

        {!dimManifestsFolder.trim() && (
          <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
            No DAZ Install Manager manifests folder is set, so a scan can list used assets but
            can't name products.{' '}
            <Link to="/settings" className="underline">
              Set it in Settings → Project
            </Link>
            .
          </p>
        )}

        <p className="mb-2 text-sm text-muted-foreground">
          Run <code>Scan_Products_{characterSlug(character)}.dsa</code> with this character's scene
          open in Daz, then check for results. Results are kept per scene — open each outfit/look
          variant and run it again to map products to every scene.
        </p>
        {scriptsAbs && (
          <PathCode path={scriptsAbs}>
            <span className="text-muted-foreground/60">{scriptsLib}</span>
            <span className="text-foreground/80">{scriptsSuffix}</span>
          </PathCode>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void router.invalidate()}>
            Check for scan results
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={clearScan}
            disabled={!productScan?.exists || clearingScan}
            title="Discard the scan results (leaves products already stored on the character untouched)"
          >
            {clearingScan ? 'Clearing…' : 'Clear'}
          </Button>
          {character.products.length > 0 && (
            <span className="text-sm text-muted-foreground">
              Stored: {character.products.length} product
              {character.products.length === 1 ? '' : 's'}
              {character.productsScannedAt
                ? ` (${new Date(character.productsScannedAt).toLocaleString()})`
                : ''}
            </span>
          )}
        </div>

        {scanFiles.length > 0 ? (
          <div className="mt-4 rounded-md border p-3">
            <div className="mb-1 font-medium">
              {scanFiles.length} scanned scene{scanFiles.length === 1 ? '' : 's'} on disk
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              One CSV per scanned scene, written here by the Daz script — the Products panel below
              is these files merged. <strong>Check for scan results</strong> re-reads them;{' '}
              <strong>Clear</strong> deletes them (products already stored on the character are
              kept).
            </p>
            {productScan?.dir && <PathCode path={productScan.dir} />}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pr-3 pb-1 font-medium">Scene</th>
                    <th className="pr-3 pb-1 font-medium">Products</th>
                    <th className="pr-3 pb-1 font-medium">Unmatched</th>
                    <th className="pr-3 pb-1 font-medium">Last written</th>
                    <th className="pr-3 pb-1 font-medium">File</th>
                  </tr>
                </thead>
                <tbody>
                  {scanFiles.map((f) => (
                    <tr key={f.name} className="border-t align-top">
                      <td className="py-1 pr-3">
                        <div className="text-foreground/90">{f.scene || '(unsaved scene)'}</div>
                        {f.scenePath && (
                          <div className="text-xs break-all text-muted-foreground/70">
                            {displayPath(f.scenePath)}
                          </div>
                        )}
                      </td>
                      <td className="py-1 pr-3 text-muted-foreground">{f.products}</td>
                      <td className="py-1 pr-3 text-muted-foreground">{f.unmatched || '—'}</td>
                      <td className="py-1 pr-3 text-muted-foreground">
                        {f.modifiedAt ? new Date(f.modifiedAt).toLocaleString() : '—'}
                      </td>
                      <td className="py-1 pr-3">
                        <code className="text-xs text-muted-foreground/70">{f.name}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No scan results found yet. Run the script in Daz, then click “Check for scan results”.
          </p>
        )}
      </section>

      {productScan?.exists && productScan.scan && (
        <section className="mb-8 rounded-lg border bg-card p-5">
          <h2 className="mb-3 text-xl font-semibold">Matched products</h2>
          <div className="mt-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm text-muted-foreground">
                {viewProducts.length} product
                {viewProducts.length === 1 ? '' : 's'}
                {viewUnmatched.length ? `, ${viewUnmatched.length} unmatched` : ''}
                {sceneFilterActive
                  ? ` · ${sceneFilter}`
                  : scanScenes.length > 1
                    ? ` · across ${scanScenes.length} scenes`
                    : scanScenes.length === 1
                      ? ` · ${scanScenes[0]}`
                      : ''}
              </span>
              <Button
                onClick={storeProducts}
                disabled={storingProducts || scanUpToDate}
                title={
                  scanUpToDate
                    ? 'The stored products already match the scan files on disk — nothing to update'
                    : undefined
                }
              >
                {scanUpToDate ? <Check /> : <Save />}{' '}
                {storingProducts
                  ? 'Storing…'
                  : scanUpToDate
                    ? 'Stored — up to date'
                    : character.products.length
                      ? 'Update stored products'
                      : 'Store on character'}
              </Button>
            </div>

            {character.products.length > 0 && (
              <div
                className={`mb-3 flex items-start gap-1.5 rounded-md border p-2 text-sm ${
                  scanUpToDate
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-amber-500/40 bg-amber-500/10'
                }`}
              >
                {scanUpToDate ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                ) : (
                  <RefreshCw className="mt-0.5 size-4 shrink-0 text-amber-500" />
                )}
                <span>
                  {scanUpToDate ? (
                    <>
                      Up to date — the {character.products.length} stored product
                      {character.products.length === 1 ? '' : 's'} match the scan files on disk.
                    </>
                  ) : (
                    <>
                      The scan on disk has changed since you last stored
                      {character.productsScannedAt
                        ? ` (saved ${new Date(character.productsScannedAt).toLocaleString()})`
                        : ''}
                      : {mergedScan?.products.length ?? 0} product
                      {(mergedScan?.products.length ?? 0) === 1 ? '' : 's'} found now vs{' '}
                      {character.products.length} stored. Click{' '}
                      <strong>Update stored products</strong> to save the latest results.
                    </>
                  )}
                </span>
              </div>
            )}

            {scanScenes.length > 1 && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">View</span>
                <button
                  type="button"
                  onClick={() => setSceneFilter(null)}
                  className={sceneChipClass(!sceneFilterActive)}
                  title="Show every product across all scanned scenes"
                >
                  All scenes
                </button>
                {scanScenes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSceneFilter(s)}
                    className={sceneChipClass(sceneFilter === s)}
                    title={`Show only products found in ${s}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {viewProducts.length > 0 ? (
              // content-visibility skips layout/paint for the whole table while
              // it's offscreen (big reports hold hundreds of rows). It sits on
              // this wrapper because table rows can't carry size containment;
              // `auto` in contain-intrinsic-size remembers the real height once
              // rendered, so scrolling back up doesn't shift.
              <div className="overflow-x-auto [contain-intrinsic-size:auto_40rem] [content-visibility:auto]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pr-3 pb-1 font-medium">Product</th>
                      <th className="pr-3 pb-1 font-medium">Used as</th>
                      <th className="pr-3 pb-1 font-medium">SKU</th>
                      <th className="pr-3 pb-1 font-medium">Artist</th>
                      <th className="pr-3 pb-1 font-medium">Version</th>
                      <th className="pr-3 pb-1 font-medium">
                        <span className="inline-flex items-center gap-0.5">
                          Match
                          <InfoPopup label="What the match methods mean">
                            <div className="space-y-1">
                              <p>How each product was identified — strongest signal first:</p>
                              <p>
                                <strong>File / Texture Match</strong> — a used file or texture lives
                                in the product's own folder (definitive).
                              </p>
                              <p>
                                <strong>SKU Match</strong> — the asset name encodes the product's
                                store SKU.
                              </p>
                              <p>
                                <strong>Keyword Match</strong> — two or more distinct words from the
                                asset's name, path or source file match the product.
                              </p>
                              <p>
                                <strong>Third-Party Match</strong> — a known non-DIM product (e.g.
                                Golden Palace).
                              </p>
                              <p>
                                <strong>Genesis Base Match</strong> — the base figure / starter
                                essentials.
                              </p>
                              <p>
                                <strong>Parent / Group Match</strong> — a sub-part inherited from a
                                matched parent garment, or a group node from its matched children.
                              </p>
                              <p>
                                <strong>Manifest Match</strong> — the node's name is a file an
                                in-scene product installs.
                              </p>
                              <p>
                                <strong>Content Folder Match</strong> — identified from the content
                                library's <code>data/&lt;Vendor&gt;/&lt;Product&gt;</code> folder.
                                Catches products with no DIM manifest (e.g. unofficial content); no
                                SKU, but the artist/version are read from the content's own files.
                              </p>
                            </div>
                          </InfoPopup>
                        </span>
                      </th>
                      {multiScene && <th className="pr-3 pb-1 font-medium">Scene(s)</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {viewProducts.map((p, i) => {
                      const url = dazProductUrl(p.sku)
                      const colCount = multiScene ? 7 : 6
                      const pkey = (p.sku || p.name).toLowerCase()
                      const open = expandedProducts.has(pkey)
                      const assets = p.usedBy ? p.usedBy.split('; ').filter(Boolean) : []
                      return (
                        <Fragment key={`${pkey}-${i}`}>
                          <tr className="border-t">
                            <td className="py-1 pr-3">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedProducts((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(pkey)) next.delete(pkey)
                                    else next.add(pkey)
                                    return next
                                  })
                                }
                                className="mr-1 inline-flex align-middle text-muted-foreground hover:text-foreground"
                                aria-label={open ? 'Hide matched assets' : 'Show matched assets'}
                              >
                                {open ? (
                                  <ChevronDown className="size-3.5" />
                                ) : (
                                  <ChevronRight className="size-3.5" />
                                )}
                              </button>
                              {url ? (
                                <a
                                  href={url}
                                  onClick={(e) => {
                                    e.preventDefault()
                                    void openExternal(url)
                                  }}
                                  className="inline-flex items-center gap-1 text-primary underline underline-offset-2"
                                  title="Open the Daz product page"
                                >
                                  {p.name}
                                  <ExternalLink className="size-3.5 shrink-0" />
                                </a>
                              ) : (
                                p.name
                              )}
                            </td>
                            <td
                              className="py-1 pr-3 text-muted-foreground"
                              title={p.usedBy ? `Used by: ${p.usedBy}` : undefined}
                            >
                              {p.usage || '—'}
                            </td>
                            <td className="py-1 pr-3 text-muted-foreground">{p.sku}</td>
                            <td className="py-1 pr-3 text-muted-foreground">{p.artist}</td>
                            <td className="py-1 pr-3 text-muted-foreground">{p.version}</td>
                            <td className="py-1 pr-3 text-muted-foreground">{p.matchMethod}</td>
                            {multiScene && (
                              <td className="py-1 pr-3 text-muted-foreground">
                                {p.scenes.join(', ')}
                              </td>
                            )}
                          </tr>
                          {open && (
                            <tr className="bg-muted/20">
                              <td colSpan={colCount} className="px-3 py-2 pl-7">
                                <div className="mb-1 text-xs text-muted-foreground">
                                  Matched by {assets.length} asset
                                  {assets.length === 1 ? '' : 's'}
                                  {multiScene
                                    ? ` · in ${p.scenes.length} scene${p.scenes.length === 1 ? '' : 's'}: ${p.scenes.join(', ')}`
                                    : ''}
                                </div>
                                {assets.length ? (
                                  <ul className="space-y-0.5 text-sm">
                                    {assets.map((a, j) => (
                                      <li
                                        key={`${a}-${j}`}
                                        // Offscreen asset rows skip layout/paint
                                        // (a product can be matched by hundreds).
                                        className="text-foreground/80 [contain-intrinsic-size:auto_1.25rem] [content-visibility:auto]"
                                      >
                                        {a}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="text-sm text-muted-foreground">
                                    No specific scene assets were recorded for this product.
                                  </span>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No products matched. The assets below are what the scan found in the scene.
              </p>
            )}

            {viewUnmatched.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  {viewUnmatched.length} unmatched asset
                  {viewUnmatched.length === 1 ? '' : 's'} (no product match)
                </summary>
                <ul className="mt-2 space-y-1 text-sm">
                  {viewUnmatched.map((a, i) => (
                    <li
                      key={`${a.technicalName}-${a.name}-${i}`}
                      // The unmatched list is the longest one on big scans —
                      // offscreen rows skip layout/paint entirely.
                      className="[contain-intrinsic-size:auto_1.25rem] [content-visibility:auto]"
                    >
                      <span className="text-foreground/80">{a.name}</span>{' '}
                      <span className="text-muted-foreground">
                        ({a.assetType}
                        {a.artist ? ` — ${a.artist}` : ''}
                        {a.version ? ` v${a.version}` : ''}
                        {a.sourceFile ? ` — ${displayPath(a.sourceFile)}` : ''})
                        {multiScene && a.scenes.length ? ` · ${a.scenes.join(', ')}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>
      )}
    </>
  )
}
