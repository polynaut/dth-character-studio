import { Fragment, memo, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

import { PathCode } from '#/components/path-code.tsx'
import { DirPathChip } from '#/components/dir-path-chip.tsx'
import { Button, InfoPopup } from '@dth/ui'
import { clearProductScan, fetchProductScan } from '#/lib/rom/api.ts'
import { openExternal } from '#/lib/desktop.ts'
import { displayPath } from '#/lib/path.ts'
import { characterSlug } from '@dth/rom'

import type { RootedDir } from '#/lib/character-paths.ts'
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
 * The character editor's "Products" tab body: what the Daz product scan found,
 * per scanned scene and merged.
 *
 * Read-only, deliberately. The results are picked up, parsed and stored without
 * being asked — every export run scans, and opening this page ingests whatever
 * Daz has left behind — so there is nothing here to approve. Before v0.70 this
 * tab carried a "found vs stored" split with a Store button; the split existed
 * only because the storing was manual.
 *
 * Memoized over what it actually READS (see the comparator on the export): the
 * route keeps it mounted-but-hidden behind the other tabs, and keyed on the whole
 * draft `character` it re-reconciled its full table (hundreds of rows) on every
 * ROM keystroke.
 */
function CharacterProductsTabImpl({
  projectId,
  character,
  productScan,
  dimManifestsFolder,
  scriptsPath,
}: {
  projectId: string
  character: Character
  /** The character's stored product results as loaded by the route
   *  (`fetchProductScan`, which ingests any fresh Daz output first). */
  productScan: Awaited<ReturnType<typeof fetchProductScan>> | null
  /** settings.dimManifestsFolder — empty means no scan can name products. */
  dimManifestsFolder: string
  /** Where the generated scripts land in the Daz library (null until "My DAZ 3D
   *  Library" is set) — rendered as the dim-root/bright-remainder chip. */
  scriptsPath: RootedDir | null
}) {
  const router = useRouter()
  const [clearingScan, setClearingScan] = useState(false)
  // Keyed by a stable product id (sku||name, lowercased) — not the row index — so
  // a row stays expanded when the scene filter changes the visible rows.
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(() => new Set())
  // The Products view can be scoped to one scene; null = all scenes (merged).
  const [sceneFilter, setSceneFilter] = useState<string | null>(null)

  // Throw the stored results away. They are fully re-derivable — the next export
  // run rebuilds them — so this needs no confirmation and no undo.
  async function clearScan() {
    if (!productScan?.exists) return
    setClearingScan(true)
    try {
      await clearProductScan({ data: { projectId, id: character.id } })
      setExpandedProducts(new Set())
      void router.invalidate()
      toast.success('Cleared the scanned products')
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
      ? mergedScan.products.filter((p) => p.scenes.includes(sceneFilter))
      : mergedScan.products
  const viewUnmatched = !mergedScan
    ? []
    : sceneFilterActive
      ? mergedScan.unmatched.filter((a) => a.scenes.includes(sceneFilter))
      : mergedScan.unmatched
  const multiScene = scanScenes.length > 1 && !sceneFilterActive
  // One row per scanned scene, as stored — what the merged panel below is made of.
  const scanScenesStored = productScan?.scenes ?? []
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
            Every export run scans the scene it just built, matches the assets it uses against your
            installed products, and files the result here — no button to press. You can also run the
            generated <code>Scan_Products_{characterSlug(character)}.dsa</code> by hand with a scene
            open in Daz; the studio picks that up the same way, next time you open this page.
          </InfoPopup>
        </h2>

        {!dimManifestsFolder.trim() && (
          <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
            No DAZ Install Manager manifests folder is set, so nothing is scanned — that folder is
            the product database a scan matches against.{' '}
            <Link to="/settings" className="underline">
              Set it in Settings
            </Link>{' '}
            and the next export run fills this page in.
          </p>
        )}

        <p className="mb-2 text-sm text-muted-foreground">
          Results are kept per scene, so each outfit/look variant maps its own products — a re-scan
          of one scene replaces only that scene's entry. You can also run{' '}
          <code>Scan_Products_{characterSlug(character)}.dsa</code> by hand from here:
        </p>
        {scriptsPath && <DirPathChip dir={scriptsPath.dir} roots={[scriptsPath.root]} />}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void router.invalidate()}>
            Check for new results
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void clearScan()}
            disabled={!productScan?.exists || clearingScan}
            title="Throw the scanned products away — the next export run rebuilds them"
          >
            {clearingScan ? 'Clearing…' : 'Clear'}
          </Button>
          {productScan?.scannedAt && (
            <span className="text-sm text-muted-foreground">
              Last scanned {new Date(productScan.scannedAt).toLocaleString()}
            </span>
          )}
        </div>

        {scanScenesStored.length > 0 ? (
          <div className="mt-4 rounded-md border p-3">
            <div className="mb-1 font-medium">
              {scanScenesStored.length} scanned scene{scanScenesStored.length === 1 ? '' : 's'}
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              The Products panel below is these merged. <strong>Clear</strong> discards the lot.
            </p>
            {productScan?.path && <PathCode path={productScan.path} />}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pr-3 pb-1 font-medium">Scene</th>
                    <th className="pr-3 pb-1 font-medium">Products</th>
                    <th className="pr-3 pb-1 font-medium">Unmatched</th>
                    <th className="pr-3 pb-1 font-medium">Scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {scanScenesStored.map((f) => (
                    <tr key={f.scenePath || f.scene} className="border-t align-top">
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
                        {f.scannedAt ? new Date(f.scannedAt).toLocaleString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Nothing scanned yet. Run a DTH Export (or the script above) and the results appear here.
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
            </div>

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

/**
 * The draft `character` is a fresh object on every ROM keystroke while this tab
 * sits hidden — compare only the fields the tab reads (id, and name via
 * `characterSlug`) plus the other props. The results themselves no longer live on
 * the character at all; they come in through `productScan` (loader data, stable).
 * `scriptsPath` is rebuilt by the route each render, so it compares by value.
 */
export const CharacterProductsTab = memo(
  CharacterProductsTabImpl,
  (prev, next) =>
    prev.projectId === next.projectId &&
    prev.productScan === next.productScan &&
    prev.dimManifestsFolder === next.dimManifestsFolder &&
    (prev.scriptsPath === next.scriptsPath ||
      (prev.scriptsPath !== null &&
        next.scriptsPath !== null &&
        prev.scriptsPath.dir === next.scriptsPath.dir &&
        prev.scriptsPath.root === next.scriptsPath.root)) &&
    prev.character.id === next.character.id &&
    prev.character.name === next.character.name,
)
