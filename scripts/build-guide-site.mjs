// Builds the getting-started guide into the Pages site: docs/guide/*.md →
// site/guide/*.html (+ a copy of docs/guide/screenshots/ and the client-side
// search's index, site/guide/search-index.json — see "Search index" below).
//
// docs/guide/ stays the single source of truth — same files GitHub renders,
// same screenshot pipeline (`pnpm screenshots`), same coverage guard. This
// script only re-skins it with the landing page's styling and a sidebar.
// Output is generated at DEPLOY time by .github/workflows/pages.yml and is
// gitignored (site/guide/) — never commit it.
//
// Run locally: pnpm build:guide   (then open site/guide/index.html)
//
// Conversions on top of plain markdown → HTML (marked, GFM):
//  - in-guide links: `./04-x.md#y` → `04-x.html#y`, `README.md` → `index.html`
//  - GitHub alerts:  `> [!NOTE]` / `[!TIP]` / … → styled <div class="alert">
//  - headings get GitHub-style ids (so existing #anchors keep working) and a
//    hover anchor link
//  - external links open in a new tab, like everywhere on the site
// Raw HTML in the markdown (<details>, <p align="center"><img>, tables) passes
// through untouched — the same reason it renders on GitHub.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marked } from 'marked'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'docs/guide')
const OUT = join(ROOT, 'site/guide')

// The sidebar: every guide page, in reading order. The build FAILS when a page
// listed here is missing or a .md exists in docs/guide that isn't listed —
// adding a chapter means placing it here consciously (same philosophy as the
// screenshot suite's coverage test).
const NAV = [
  {
    group: 'Guides',
    pages: [
      'README.md',
      '01-installation.md',
      '02-setup.md',
      '03-first-project.md',
      '04-first-character.md',
      '05-rom-in-daz.md',
      '06-into-houdini.md',
    ],
  },
  {
    group: 'Deep dives',
    pages: ['advanced.md', 'tools.md', 'attachments.md', 'product-scanning.md'],
  },
]

const htmlName = (md) => (md === 'README.md' ? 'index.html' : md.replace(/\.md$/, '.html'))

/** Drop HTML tags from a rendered heading. Loops to a fixpoint so nested
 *  fragments can't reassemble into a tag (CodeQL
 *  js/incomplete-multi-character-sanitization) — and the allowlist in
 *  `slugify` below is the actual safety net: a slug can only ever contain
 *  letters, numbers and dashes. */
const stripTags = (s) => {
  let out = s
  for (let prev; prev !== out; ) {
    prev = out
    out = out.replace(/<[^>]*>/g, '')
  }
  return out
}

/** GitHub-flavoured heading slug (close enough for the guide's anchors). */
const slugify = (text) =>
  stripTags(text.toLowerCase().trim())
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-')

const escapeHtml = (s) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const ALERT_RE = /^<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br\s*\/?>)?\s*/
const ALERT_LABELS = { NOTE: 'Note', TIP: 'Tip', IMPORTANT: 'Important', WARNING: 'Warning', CAUTION: 'Caution' }

/** One render pass per page — the heading slugger must reset per file, and
 *  the accordion post-pass draws its ids from the same dedup pool (headings
 *  claim theirs first, during parse). */
function renderPage(source) {
  const seen = new Map()
  const takeSlug = (text) => {
    const base = slugify(text)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n > 0 ? `${base}-${n}` : base
  }
  const marked = new Marked({ gfm: true })
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens)
        const id = takeSlug(text)
        return `<h${depth} id="${id}">${text}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens)
        const t = title ? ` title="${escapeHtml(title)}"` : ''
        // In-guide markdown link → the generated page.
        const inGuide = /^(?:\.\/)?([\w.-]+\.md)(#.*)?$/.exec(href)
        if (inGuide) return `<a href="${htmlName(inGuide[1])}${inGuide[2] ?? ''}"${t}>${text}</a>`
        if (/^https?:\/\//.test(href))
          return `<a href="${href}"${t} target="_blank" rel="noopener">${text}</a>`
        return `<a href="${href}"${t}>${text}</a>`
      },
      blockquote({ tokens }) {
        const body = this.parser.parse(tokens)
        const m = ALERT_RE.exec(body)
        if (!m) return false // not an alert — default blockquote
        const kind = m[1]
        const rest = body.replace(ALERT_RE, '<p>').replace(/<p>\s*<\/p>/g, '')
        return `<div class="alert alert-${kind.toLowerCase()}"><p class="alert-title">${ALERT_LABELS[kind]}</p>${rest}</div>\n`
      },
    },
  })
  let html = marked.parse(source)
  // Accordions become anchorable like headings: each <details> gets an id
  // from its summary text, and the summary a hover link icon. guide.js keeps
  // a click on the icon from toggling the box, and opens + scrolls the box
  // when a visited URL's hash targets one.
  html = html.replace(/<details>\s*<summary>([\s\S]*?)<\/summary>/g, (_, inner) => {
    // Entities would slug as words ("&amp;" → "-amp-"); these ids are new,
    // so no GitHub-slug compatibility to preserve — just drop them. Drop, not
    // space-replace: "morphs &amp; node" must slug with two dashes (like a
    // stripped "&" would), or links written against the visible text miss.
    const id = takeSlug(inner.replace(/&[a-z]+;|&#\d+;/gi, ''))
    return (
      `<details id="${id}"><summary>${inner}` +
      `<a class="details-anchor" href="#${id}" aria-label="Copy link to this section">#</a></summary>`
    )
  })
  // Sticky chapter titles: wrap each h2-to-h2 chunk in a <section> so the
  // sticky heading is bounded by its own section — the next chapter's title
  // then pushes the stuck one away instead of overlapping it (guide.css).
  const parts = html.split(/(?=<h2 )/)
  if (parts.length > 1) {
    html =
      parts[0] +
      parts
        .slice(1)
        .map((chunk) => `<section class="guide-section">\n${chunk}</section>\n`)
        .join('')
  }
  return html
}

const pages = NAV.flatMap((g) => g.pages)
const onDisk = readdirSync(SRC).filter((f) => f.endsWith('.md'))
const missing = pages.filter((p) => !onDisk.includes(p))
const unlisted = onDisk.filter((f) => !pages.includes(f))
if (missing.length) throw new Error(`NAV lists missing guide pages: ${missing.join(', ')}`)
if (unlisted.length) throw new Error(`docs/guide has pages not in NAV (place them): ${unlisted.join(', ')}`)

// Screenshot references ↔ files on disk — the static mirror of the screenshot
// suite's `coverage` test (guide.screenshots.ts), so a page referencing a
// missing PNG (or a PNG no page references) fails the PR/deploy build instead
// of shipping a broken image. Same reference regex as the coverage test.
const shotsDir = join(SRC, 'screenshots')
const referencedShots = new Set()
for (const md of pages) {
  const text = readFileSync(join(SRC, md), 'utf8')
  for (const m of text.matchAll(/screenshots\/([\w.-]+\.png)/g)) referencedShots.add(m[1])
}
const shotsOnDisk = readdirSync(shotsDir).filter((f) => f.endsWith('.png'))
const missingShots = [...referencedShots].filter((f) => !shotsOnDisk.includes(f)).sort()
const orphanShots = shotsOnDisk.filter((f) => !referencedShots.has(f)).sort()
if (missingShots.length)
  throw new Error(
    `guide references screenshots that don't exist (run \`pnpm screenshots\` or fix the reference): ${missingShots.join(', ')}`,
  )
if (orphanShots.length)
  throw new Error(
    `screenshots referenced by no guide page (delete them + their shot test, or reference them): ${orphanShots.join(', ')}`,
  )

// Same guard for the interaction GIFs (docs/guide/gifs/, generated by
// guide.gifs.ts) — a missing/renamed GIF must fail the build, not deploy as a
// broken image. Same reference regex as the coverage test.
const gifsDir = join(SRC, 'gifs')
const referencedGifs = new Set()
for (const md of pages) {
  const text = readFileSync(join(SRC, md), 'utf8')
  for (const m of text.matchAll(/gifs\/([\w.-]+\.gif)/g)) referencedGifs.add(m[1])
}
const gifsOnDisk = existsSync(gifsDir) ? readdirSync(gifsDir).filter((f) => f.endsWith('.gif')) : []
const missingGifs = [...referencedGifs].filter((f) => !gifsOnDisk.includes(f)).sort()
const orphanGifs = gifsOnDisk.filter((f) => !referencedGifs.has(f)).sort()
if (missingGifs.length)
  throw new Error(
    `guide references GIFs that don't exist (run \`pnpm --filter @dth/web gifs\` or fix the reference): ${missingGifs.join(', ')}`,
  )
if (orphanGifs.length)
  throw new Error(
    `GIFs referenced by no guide page (delete them + their gif test, or reference them): ${orphanGifs.join(', ')}`,
  )

// Same guard for the interaction clips (docs/guide/clips/, animated .webp
// generated by guide.clips.ts) — a missing/renamed clip must fail the build,
// not deploy as a broken image. Same reference regex as the coverage test.
const clipsDir = join(SRC, 'clips')
const referencedClips = new Set()
for (const md of pages) {
  const text = readFileSync(join(SRC, md), 'utf8')
  for (const m of text.matchAll(/clips\/([\w.-]+\.webp)/g)) referencedClips.add(m[1])
}
const clipsOnDisk = existsSync(clipsDir) ? readdirSync(clipsDir).filter((f) => f.endsWith('.webp')) : []
const missingClips = [...referencedClips].filter((f) => !clipsOnDisk.includes(f)).sort()
const orphanClips = clipsOnDisk.filter((f) => !referencedClips.has(f)).sort()
if (missingClips.length)
  throw new Error(
    `guide references clips that don't exist (run \`pnpm --filter @dth/web clips\` or fix the reference): ${missingClips.join(', ')}`,
  )
if (orphanClips.length)
  throw new Error(
    `clips referenced by no guide page (delete them + their clip test, or reference them): ${orphanClips.join(', ')}`,
  )

const titleOf = (md) => {
  const first = readFileSync(join(SRC, md), 'utf8').split('\n', 1)[0]
  if (!first.startsWith('# ')) throw new Error(`${md}: first line must be an "# " title`)
  return first.slice(2).trim()
}
const titles = new Map(pages.map((p) => [p, titleOf(p)]))

// Sidebar labels drop the "Deep dive: " title prefix and the "(optional)"
// suffix — noise in the nav (the page H1s and the pager keep the full title).
const sidebarLabel = (md) => {
  const t = titles
    .get(md)
    .replace(/^Deep dive: /, '')
    .replace(/\s*\(optional\)$/, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// The <title> tag (browser tab / address bar) drops the leading "N · " step
// number too — a title starting with a digit looks odd there. The on-page H1
// and the pager keep it (it's useful reading order, just not as a title).
const pageTitle = (md) => titles.get(md).replace(/^\d+\s*·\s*/, '')

const sidebar = (current) =>
  NAV.map(
    (g) => `
      <p class="guide-group">${g.group}</p>
      <ul>
        ${g.pages
          .map((p) => {
            const cls = p === current ? ' class="active" aria-current="page"' : ''
            return `<li><a href="${htmlName(p)}"${cls}>${escapeHtml(sidebarLabel(p))}</a></li>`
          })
          .join('\n        ')}
      </ul>`,
  ).join('\n')

const pager = (md) => {
  const i = pages.indexOf(md)
  const link = (p, cls, label) =>
    p
      ? `<a class="pager-link ${cls}" href="${htmlName(p)}"><span>${label}</span><strong>${escapeHtml(titles.get(p))}</strong></a>`
      : '<span></span>'
  return `<nav class="guide-pager" aria-label="Chapter navigation">
    ${link(pages[i - 1], 'prev', '← Previous')}
    ${link(pages[i + 1], 'next', 'Next →')}
  </nav>`
}

const shell = (md, content) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="theme-color" content="#232323" />
    <title>${escapeHtml(pageTitle(md))} · DTH Character Studio</title>
    <link rel="icon" href="../assets/logo-192.png" />
    <link rel="stylesheet" href="../styles.css" />
    <link rel="stylesheet" href="../guide.css" />
    <script src="../guide.js" defer></script>
    <script src="../search.js" defer></script>
  </head>
  <body class="guide-body">
    <header class="topbar shown">
      <div class="container topbar-inner">
        <a class="topbar-brand" href="../">
          <img src="../assets/logo-192.png" alt="" width="26" height="26" />
          <span>DTH Character Studio</span>
        </a>
        <nav class="topbar-nav" aria-label="Guide">
          <a href="../#features">Why?</a>
          <a href="index.html"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>Getting started</a>
        </nav>
        <div class="topbar-actions">
          <button class="topbar-search" type="button" title="Search the docs (Ctrl+K / ⌘K)" aria-label="Search the docs" aria-keyshortcuts="Control+K Meta+K">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <span>Search docs</span>
            <kbd>⌘/Ctrl K</kbd>
          </button>
          <span class="topbar-sep" aria-hidden="true"></span>
          <a class="btn btn-primary btn-compact" href="../" aria-label="Download">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span class="btn-label">Download</span>
          </a>
        </div>
      </div>
    </header>
    <div class="container guide-layout">
      <aside class="guide-sidebar">
        <nav aria-label="Guide chapters">${sidebar(md)}
        </nav>
      </aside>
      <article class="guide-content">
${content}
${pager(md)}
      </article>
    </div>
    <footer class="footer">
      <div class="container footer-inner">
        <p>
          <a href="https://github.com/polynaut/dth-character-studio/blob/main/LICENSE" target="_blank" rel="noopener">MIT license</a>
          <span class="footer-sep">·</span>
          <a class="gh-link" href="https://github.com/polynaut/dth-character-studio" target="_blank" rel="noopener"><svg class="gh-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>GitHub</a>
        </p>
        <p class="footer-fine">Not affiliated with Daz 3D, SideFX, or Epic Games.</p>
      </div>
    </footer>
  </body>
</html>
`

/** The markdown files end in their own prev/next line ("[← …](…) · [Next: …")
 *  for the GitHub rendering — the site has the pager cards instead, so that
 *  trailing nav line is dropped here (the .md files keep it). */
function stripMdFooterNav(md) {
  const lines = md.trimEnd().split('\n')
  if (/^\[← .*\)$/.test(lines.at(-1))) lines.pop()
  return lines.join('\n')
}

// ── Image space reservation ──────────────────────────────────────────────────
// Anchor navigation (#section links, search results) scrolls BEFORE the big
// screenshots have loaded — without known dimensions every finished image then
// pushes the target further down, and the visitor lands somewhere random.
// Every guide image is static, so every size is knowable at build time: local
// assets are read from disk, external ones (GitHub user-attachments) fetched
// once here. Each <img> gets an aspect-ratio style so its box height is
// reserved from first paint and the native anchor scroll lands exactly.
// A failed external fetch skips the stamp with a warning — guide.js re-anchors
// on `load` as the fallback for exactly that case.

/** Pixel dimensions from the image bytes, sniffed by magic number — PNG
 *  (IHDR), GIF (logical screen), WebP (VP8X extended / VP8 lossy / VP8L
 *  lossless). Null when unrecognized. */
function imageDims(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47)
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  if (buf.length > 10 && buf.toString('ascii', 0, 4) === 'GIF8')
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) }
  if (buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const fourCC = buf.toString('ascii', 12, 16)
    if (fourCC === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) }
    if (fourCC === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff }
    if (fourCC === 'VP8L') {
      const bits = buf.readUInt32LE(21)
      return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) }
    }
  }
  return null
}

/** Dimensions of an external image, fetched once per URL across the whole
 *  build. Null (with a warning) on any failure — never fails the build over a
 *  CDN hiccup; the affected image just keeps the load-time re-anchor fallback. */
const externalDimsCache = new Map()
async function externalImageDims(url) {
  if (externalDimsCache.has(url)) return externalDimsCache.get(url)
  let dims = null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) dims = imageDims(Buffer.from(await res.arrayBuffer()))
    if (!dims) console.warn(`could not size external image (${res.status}): ${url}`)
  } catch (e) {
    console.warn(`could not fetch external image: ${url} (${e.message})`)
  }
  externalDimsCache.set(url, dims)
  return dims
}

/** Stamp every `<img>` with its natural aspect ratio — local assets
 *  (screenshots/clips/gifs) from disk, http(s) sources via fetch. The attrs
 *  stay untouched: CSS already governs display width, the ratio just gives the
 *  box its height before load. */
async function reserveImageSpace(html) {
  const jobs = []
  html.replace(/<img\b[^>]*?>/g, (tag, at) => {
    if (/\bstyle="/.test(tag)) return tag
    const src = /\bsrc="([^"]+)"/.exec(tag)?.[1]
    if (!src) return tag
    if (/^(?:screenshots|clips|gifs)\//.test(src)) {
      const dims = imageDims(readFileSync(join(SRC, decodeURIComponent(src))))
      if (dims) jobs.push(Promise.resolve({ at, tag, dims }))
    } else if (/^https?:\/\//.test(src)) {
      jobs.push(externalImageDims(src).then((dims) => ({ at, tag, dims })))
    }
    return tag
  })
  // Splice back-to-front so earlier match offsets stay valid.
  for (const { at, tag, dims } of (await Promise.all(jobs)).reverse()) {
    if (!dims) continue
    const stamped = tag.replace(/^<img\b/, `<img style="aspect-ratio: ${dims.w} / ${dims.h}"`)
    html = html.slice(0, at) + stamped + html.slice(at + tag.length)
  }
  return html
}

// ── Search index ─────────────────────────────────────────────────────────────
// The guide's client-side search (guide.js) runs on search-index.json: one
// entry per heading section, cut from the SAME rendered HTML the pages ship
// with, so every entry deep-links to an anchor id that actually exists.
// Regenerated on every build — a new page or section needs no extra step.

/** The handful of entities marked emits for text content, back to plain text
 *  (`&amp;` last, so a literal `&amp;amp;` can't double-decode). */
const decodeEntities = (s) =>
  s
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

const HEADING_START_RE = /^<h([1-6]) id="([^"]+)">([\s\S]*?)<a class="anchor"[\s\S]*?<\/h\1>/

/** One rendered page → its search entries. A section starts at each id'd
 *  heading (every heading gets one in renderPage) and runs to the next one;
 *  accordion content inside a section counts as its body text. ACCORDIONS
 *  additionally index as their own entries — their titles are anchorable
 *  section titles in their own right, and folded into a parent body they
 *  were effectively unfindable. */
function indexPage(md, html) {
  const entries = []
  // No .slice(1) to drop a pre-heading preamble: a zero-width split yields NO
  // leading chunk when the html starts at a heading (which every page does —
  // slicing here silently dropped all the h1 entries). The regex below
  // rejects a non-heading first chunk anyway.
  for (const chunk of html.split(/(?=<h[1-6] id=)/)) {
    const m = HEADING_START_RE.exec(chunk)
    if (!m) continue
    const body = chunk
      .slice(m[0].length)
      // The accordion summaries' "#" anchor glyph is chrome, not content.
      .replace(/<a class="details-anchor"[^>]*>#<\/a>/g, '')
    entries.push({
      page: htmlName(md),
      title: pageTitle(md),
      level: Number(m[1]),
      id: m[2],
      heading: decodeEntities(stripTags(m[3])).trim(),
      text: decodeEntities(stripTags(body)).replace(/\s+/g, ' ').trim(),
    })
  }
  // Level 6 = below every heading in the scorer's level bonus; the client
  // renders and deep-links it exactly like any other section entry.
  for (const d of html.matchAll(/<details id="([^"]+)"><summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)) {
    const summary = d[2].replace(/<a class="details-anchor"[^>]*>#<\/a>/g, '')
    entries.push({
      page: htmlName(md),
      title: pageTitle(md),
      level: 6,
      id: d[1],
      heading: decodeEntities(stripTags(summary)).trim(),
      text: decodeEntities(stripTags(d[3])).replace(/\s+/g, ' ').trim(),
    })
  }
  return entries
}

const searchIndex = []
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
for (const md of pages) {
  const html = await reserveImageSpace(renderPage(stripMdFooterNav(readFileSync(join(SRC, md), 'utf8'))))
  const pageEntries = indexPage(md, html)
  // Every page has at least its own H1 (titleOf enforces the "# " first line) —
  // a page yielding nothing means indexPage no longer matches renderPage's
  // heading markup. Fail the build rather than deploy unsearchable pages.
  if (!pageEntries.length)
    throw new Error(`${md}: no search entries extracted — indexPage vs renderPage markup drift`)
  searchIndex.push(...pageEntries)
  writeFileSync(join(OUT, htmlName(md)), shell(md, html))
}
writeFileSync(join(OUT, 'search-index.json'), JSON.stringify(searchIndex))

// In-guide hash links must point at ids that EXIST in their target page — a
// renamed heading/accordion (or a changed slug rule) otherwise ships a
// silently dead deep link: the page opens at the top and nobody errors.
// Validated on the BUILT pages, so heading ids, accordion ids and the pager
// all count. External hrefs don't match the pattern.
{
  const built = new Map(pages.map((md) => [htmlName(md), readFileSync(join(OUT, htmlName(md)), 'utf8')]))
  const dead = []
  for (const [name, html] of built) {
    for (const m of html.matchAll(/href="([\w.-]+\.html)?#([^"]+)"/g)) {
      const targetHtml = built.get(m[1] ?? name)
      if (targetHtml && !targetHtml.includes(`id="${m[2]}"`))
        dead.push(`${name}: ${m[1] ?? ''}#${m[2]}`)
    }
  }
  if (dead.length)
    throw new Error(`in-guide hash links point at ids that don't exist:\n  ${dead.join('\n  ')}`)
}
cpSync(join(SRC, 'screenshots'), join(OUT, 'screenshots'), { recursive: true })
if (existsSync(join(SRC, 'clips'))) cpSync(join(SRC, 'clips'), join(OUT, 'clips'), { recursive: true })
if (existsSync(join(SRC, 'gifs'))) cpSync(join(SRC, 'gifs'), join(OUT, 'gifs'), { recursive: true })

// Deploy-artifact check: every referenced asset must land in the OUTPUT, not
// just exist in SRC. The guards above are source-side — they can't see a
// dropped or mis-pathed cpSync (the exact bug that shipped clips broken). This
// re-checks the same referenced sets against the built site, so removing a copy
// step fails the build instead of deploying a broken image.
const outMissing = [
  ...[...referencedShots].map((f) => `screenshots/${f}`),
  ...[...referencedClips].map((f) => `clips/${f}`),
  ...[...referencedGifs].map((f) => `gifs/${f}`),
].filter((rel) => !existsSync(join(OUT, rel)))
if (outMissing.length)
  throw new Error(
    `built site is missing referenced assets (a copy step above is broken): ${outMissing.join(', ')}`,
  )

console.log(
  `guide → site/guide: ${pages.length} pages (+${searchIndex.length}-entry search index) + screenshots + clips + gifs`,
)
