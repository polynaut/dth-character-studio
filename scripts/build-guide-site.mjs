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

import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
    group: 'Guide',
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

/** One Marked instance per page — the heading slugger must reset per file. */
function pageRenderer() {
  const seen = new Map()
  const marked = new Marked({ gfm: true })
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens)
        let id = slugify(text)
        const n = seen.get(id) ?? 0
        seen.set(id, n + 1)
        if (n > 0) id = `${id}-${n}`
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
  return marked
}

const pages = NAV.flatMap((g) => g.pages)
const onDisk = readdirSync(SRC).filter((f) => f.endsWith('.md'))
const missing = pages.filter((p) => !onDisk.includes(p))
const unlisted = onDisk.filter((f) => !pages.includes(f))
if (missing.length) throw new Error(`NAV lists missing guide pages: ${missing.join(', ')}`)
if (unlisted.length) throw new Error(`docs/guide has pages not in NAV (place them): ${unlisted.join(', ')}`)

const titleOf = (md) => {
  const first = readFileSync(join(SRC, md), 'utf8').split('\n', 1)[0]
  if (!first.startsWith('# ')) throw new Error(`${md}: first line must be an "# " title`)
  return first.slice(2).trim()
}
const titles = new Map(pages.map((p) => [p, titleOf(p)]))

const sidebar = (current) =>
  NAV.map(
    (g) => `
      <p class="guide-group">${g.group}</p>
      <ul>
        ${g.pages
          .map((p) => {
            const cls = p === current ? ' class="active" aria-current="page"' : ''
            return `<li><a href="${htmlName(p)}"${cls}>${escapeHtml(titles.get(p))}</a></li>`
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
  </head>
  <body class="guide-body">
    <header class="topbar shown">
      <div class="container topbar-inner">
        <a class="topbar-brand" href="../">
          <img src="../assets/logo-192.png" alt="" width="26" height="26" />
          <span>DTH Character Studio</span>
        </a>
        <nav class="topbar-nav" aria-label="Guide">
          <a href="index.html">Guide</a>
          <a href="https://github.com/polynaut/dth-character-studio" target="_blank" rel="noopener">GitHub</a>
        </nav>
        <a class="btn btn-primary btn-compact" href="../">Download</a>
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
          <a href="https://github.com/polynaut/dth-character-studio/blob/main/LICENSE" target="_blank" rel="noopener">MIT</a>
          © Polynaut
        </p>
        <p class="footer-fine">Not affiliated with Daz 3D, SideFX, or Epic Games.</p>
      </div>
    </footer>
  </body>
</html>
`

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
for (const md of pages) {
  const html = pageRenderer().parse(readFileSync(join(SRC, md), 'utf8'))
  writeFileSync(join(OUT, htmlName(md)), shell(md, html))
}
cpSync(join(SRC, 'screenshots'), join(OUT, 'screenshots'), { recursive: true })
console.log(`guide → site/guide: ${pages.length} pages + screenshots`)
