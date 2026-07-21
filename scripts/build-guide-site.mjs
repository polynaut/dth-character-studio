// Builds the getting-started guide into the Pages site: docs/guide/*.md →
// site/guide/*.html (+ a copy of docs/guide/screenshots/).
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
    // so no GitHub-slug compatibility to preserve — just drop them.
    const id = takeSlug(inner.replace(/&[a-z]+;|&#\d+;/gi, ' '))
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

// The guide's landing page gets a prominent GitHub button after its intro
// paragraph — injected at build time so the markdown stays clean on GitHub.
const GH_BUTTON =
  '\n<p><a class="btn btn-secondary btn-gh" href="https://github.com/polynaut/dth-character-studio" target="_blank" rel="noopener">' +
  '<svg class="gh-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>' +
  'GitHub Repository</a></p>'

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
    <title>${escapeHtml(titles.get(md))} · DTH Character Studio</title>
    <link rel="icon" href="../assets/logo-192.png" />
    <link rel="stylesheet" href="../styles.css" />
    <link rel="stylesheet" href="../guide.css" />
    <script src="../guide.js" defer></script>
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
        <a class="btn btn-primary btn-compact" href="../">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Download
        </a>
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

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
for (const md of pages) {
  let html = renderPage(stripMdFooterNav(readFileSync(join(SRC, md), 'utf8')))
  if (md === 'README.md') html = html.replace('</p>', `</p>${GH_BUTTON}`)
  writeFileSync(join(OUT, htmlName(md)), shell(md, html))
}
cpSync(join(SRC, 'screenshots'), join(OUT, 'screenshots'), { recursive: true })
if (existsSync(join(SRC, 'gifs'))) cpSync(join(SRC, 'gifs'), join(OUT, 'gifs'), { recursive: true })
console.log(`guide → site/guide: ${pages.length} pages + screenshots + gifs`)
