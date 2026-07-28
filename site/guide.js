// Guide lightbox: the article shows app screenshots at ~66% of their native
// size (the text column) — clicking one opens it at 100% in an overlay. Click
// anywhere or press Escape to close; tall images scroll inside the overlay.

const overlay = document.createElement('div')
overlay.className = 'guide-lightbox'
overlay.setAttribute('role', 'dialog')
overlay.setAttribute('aria-label', 'Screenshot at full size')
document.body.appendChild(overlay)

function close() {
  overlay.classList.remove('open')
  overlay.replaceChildren()
  document.body.style.overflow = ''
}

document.addEventListener('click', (e) => {
  if (overlay.classList.contains('open')) {
    close() // any click inside the open overlay closes it
    return
  }
  const img = e.target.closest('.guide-content img')
  if (!img) return
  const full = document.createElement('img')
  full.src = img.currentSrc || img.src
  full.alt = img.alt
  // App screenshots are 2560px @2x → 100% = 1280 CSS px (viewport-capped);
  // other images (external photos) open at their natural size instead.
  if (/\/screenshots\//.test(full.src)) full.style.width = 'min(1280px, 96vw)'
  else full.style.maxWidth = '96vw'
  // Inner wrapper with margin:auto — centers vertically AND stays scrollable
  // when the image is taller than the viewport (auto margins collapse to 0).
  const inner = document.createElement('div')
  inner.className = 'lightbox-inner'
  inner.appendChild(full)
  // Carry the article's caption (the <sub> sharing the image's paragraph)
  // into the overlay; fall back to the alt text.
  const caption = img.closest('p')?.querySelector('sub')?.textContent?.trim() || img.alt
  if (caption) {
    const cap = document.createElement('p')
    cap.className = 'lightbox-caption'
    cap.textContent = caption
    inner.appendChild(cap)
  }
  overlay.replaceChildren(inner)
  overlay.classList.add('open')
  document.body.style.overflow = 'hidden'
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay.classList.contains('open')) close()
})

// ── Anchorable accordions ────────────────────────────────────────────────────
// The build gives each <details> an id and a hover link icon in its summary
// (build-guide-site.mjs). Clicking the icon only puts the anchor in the URL —
// no toggle, no jump; clicking elsewhere on the title toggles as usual. And
// visiting a link whose hash targets an accordion opens it and smooth-scrolls
// its title into view once the page has loaded.
// One behavior for BOTH anchor kinds — heading "#" links and accordion "#"
// links: the anchor lands in the URL (no jump), the full link is copied, and
// the glyph flashes orange as confirmation. For accordions preventDefault
// also cancels the summary toggle. Clipboard access can be denied
// (permissions, insecure context) — then the URL bar still carries the
// anchor, so failing silently is fine.
document.addEventListener('click', (e) => {
  const a = e.target.closest('.details-anchor, .guide-content .anchor')
  if (!a) return
  e.preventDefault()
  history.replaceState(null, '', a.getAttribute('href'))
  navigator.clipboard?.writeText(location.href).then(
    () => {
      a.classList.add('copied')
      setTimeout(() => a.classList.remove('copied'), 1200)
    },
    () => {},
  )
})

// Clicking a DOCKED accordion title (sticky, ridden down from its resting
// place) doesn't close the box — closing would teleport the page content.
// Instead it smooth-scrolls the accordion back to the top; a second click on
// the now-resting title closes it as usual.
document.addEventListener('click', (e) => {
  const summary = e.target.closest('.guide-content details[open] > summary')
  if (!summary || e.target.closest('.details-anchor')) return
  const details = summary.parentElement
  const docked = summary.getBoundingClientRect().top > details.getBoundingClientRect().top + 3
  if (!docked) return
  e.preventDefault()
  details.scrollIntoView({ behavior: 'smooth', block: 'start' }) // rides the details' scroll-margin
})

function revealHashAccordion() {
  const id = decodeURIComponent(location.hash.slice(1))
  const details = id ? document.getElementById(id)?.closest('details') : null
  if (!details) return
  details.open = true
  details.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
window.addEventListener('hashchange', revealHashAccordion)
// After load, not DOMContentLoaded — images have sized by then, so the
// scroll target doesn't drift while screenshots stream in.
if (document.readyState === 'complete') revealHashAccordion()
else window.addEventListener('load', revealHashAccordion)

// ── Mobile: land on the new chapter's title ──────────────────────────────────
// On a narrow viewport the sidebar stacks ABOVE the article (guide.css), so
// following a chapter link drops the reader back at the nav, not the chapter.
// Flag the click and, once the destination page has loaded on a mobile
// viewport, glide its H1 into view (its scroll-margin clears the topbar).
const isMobileGuide = () => window.matchMedia('(max-width: 900px)').matches
const JUMP_KEY = 'dth-guide-jump-h1'

document.addEventListener('click', (e) => {
  if (!isMobileGuide() || !e.target.closest('.guide-sidebar a')) return
  try {
    sessionStorage.setItem(JUMP_KEY, '1')
  } catch {
    /* storage blocked — the jump just won't fire, no harm */
  }
})

function jumpToChapterTitle() {
  let flagged = null
  try {
    flagged = sessionStorage.getItem(JUMP_KEY)
    if (flagged) sessionStorage.removeItem(JUMP_KEY)
  } catch {
    return
  }
  // No jump when there's no flag, on desktop, or when a hash already targets a
  // spot in the page (a deep link wins over the title jump).
  if (!flagged || !isMobileGuide() || location.hash) return
  document.querySelector('.guide-content h1')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
if (document.readyState === 'complete') jumpToChapterTitle()
else window.addEventListener('load', jumpToChapterTitle)

// ── Guide search ─────────────────────────────────────────────────────────────
// Docs-style search over the whole guide, no service involved: the index is
// generated at build time (search-index.json — one entry per heading section,
// build-guide-site.mjs) and fetched once, when the search first opens. Query
// words AND-match; heading hits rank over page-title hits over body hits;
// every result deep-links to its section's anchor. Opens via the topbar
// button, Ctrl/⌘+K or `/`; ↑/↓ + Enter navigate, Escape closes.

const searchOverlay = document.createElement('div')
searchOverlay.className = 'guide-search'
searchOverlay.innerHTML = `
  <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search the guide">
    <div class="search-box">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" placeholder="Search the guide…" aria-label="Search query" autocomplete="off" autocapitalize="off" spellcheck="false" />
      <button type="button" class="search-close" aria-label="Close search"><kbd>Esc</kbd></button>
    </div>
    <ul class="search-results" role="listbox" aria-label="Search results"></ul>
    <p class="search-status"></p>
  </div>`
document.body.appendChild(searchOverlay)

const searchInput = searchOverlay.querySelector('input')
const searchResults = searchOverlay.querySelector('.search-results')
const searchStatus = searchOverlay.querySelector('.search-status')

let searchIndex = null // null until the fetch lands; [] + searchIndexFailed on error
let searchIndexFailed = false
let searchFetch = null
let activeResult = -1

function ensureSearchIndex() {
  searchFetch ??= fetch('search-index.json')
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((entries) => {
      // Precompute the lowercase match targets once — the scorer runs
      // entries × keystrokes times.
      searchIndex = entries.map((e) => ({
        ...e,
        h: e.heading.toLowerCase(),
        t: e.title.toLowerCase(),
        b: e.text.toLowerCase(),
      }))
    })
    .catch(() => {
      searchIndex = []
      searchIndexFailed = true
    })
    .finally(() => renderSearchResults())
  return searchFetch
}

/** AND-match `terms` against one entry; 0 = no match. Word-start heading hits
 *  weigh most, then anywhere-in-heading, page title, body; a multi-word query
 *  appearing as a whole phrase outranks scattered single-word hits. The small
 *  level bonus floats a page's own entry over its subsections on ties. */
function scoreEntry(entry, terms, phrase) {
  let score = 0
  for (const term of terms) {
    const h = entry.h.indexOf(term)
    const b = entry.b.indexOf(term)
    const inTitle = entry.t.includes(term)
    if (h < 0 && b < 0 && !inTitle) return 0
    if (h >= 0) score += h === 0 || entry.h[h - 1] === ' ' ? 140 : 90
    if (inTitle) score += 25
    if (b >= 0) score += b === 0 || /\W/.test(entry.b[b - 1]) ? 12 : 6
  }
  if (terms.length > 1) {
    if (entry.h.includes(phrase)) score += 80
    else if (entry.b.includes(phrase)) score += 30
  }
  return score + (entry.level === 1 ? 10 : entry.level === 2 ? 4 : 0)
}

/** A ~160-char window of the entry's text around the first term hit (aligned
 *  to a word start), or the text's beginning for a heading-only match. */
function searchExcerpt(entry, terms) {
  const hits = terms.map((t) => entry.b.indexOf(t)).filter((i) => i >= 0)
  if (!hits.length) return entry.text.slice(0, 160)
  const first = Math.min(...hits)
  const from = Math.max(0, first - 40)
  const space = entry.b.indexOf(' ', from)
  const start = from === 0 ? 0 : space >= 0 && space < first ? space + 1 : from
  const slice = entry.text.slice(start, start + 160)
  return (start > 0 ? '…' : '') + slice + (start + 160 < entry.text.length ? '…' : '')
}

/** `text` with every term occurrence wrapped in <mark> — built via DOM nodes,
 *  so index text can never inject markup. */
function highlightTerms(text, terms) {
  const frag = document.createDocumentFragment()
  const lower = text.toLowerCase()
  let pos = 0
  for (;;) {
    let next = -1
    let len = 0
    for (const term of terms) {
      const i = lower.indexOf(term, pos)
      if (i >= 0 && (next < 0 || i < next)) {
        next = i
        len = term.length
      }
    }
    if (next < 0) break
    if (next > pos) frag.append(text.slice(pos, next))
    const mark = document.createElement('mark')
    mark.textContent = text.slice(next, next + len)
    frag.append(mark)
    pos = next + len
  }
  frag.append(text.slice(pos))
  return frag
}

function setActiveResult(index) {
  const items = searchResults.querySelectorAll('li')
  if (!items.length) return
  activeResult = (index + items.length) % items.length
  items.forEach((li, i) => {
    li.classList.toggle('active', i === activeResult)
    li.setAttribute('aria-selected', String(i === activeResult))
  })
  items[activeResult].scrollIntoView({ block: 'nearest' })
}

function renderSearchResults() {
  const query = searchInput.value.trim()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  searchResults.replaceChildren()
  activeResult = -1
  const status = (msg) => {
    searchStatus.textContent = msg
    searchStatus.hidden = !msg
  }
  if (!terms.length) return status('Type to search the guide')
  if (searchIndexFailed) return status('Search is unavailable — the index failed to load.')
  if (!searchIndex) return status('Loading…') // re-rendered when the fetch lands
  const phrase = terms.join(' ')
  const ranked = searchIndex
    .map((entry) => ({ entry, score: scoreEntry(entry, terms, phrase) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
  if (!ranked.length) return status(`No matches for “${query}”`)
  status('')
  for (const { entry } of ranked) {
    const li = document.createElement('li')
    li.setAttribute('role', 'option')
    const a = document.createElement('a')
    a.href = entry.level === 1 ? entry.page : `${entry.page}#${entry.id}`
    const path = document.createElement('span')
    path.className = 'result-path'
    path.append(highlightTerms(entry.title, terms))
    if (entry.level > 1) {
      const sep = document.createElement('span')
      sep.className = 'result-sep'
      sep.textContent = '›'
      path.append(' ', sep, ' ', highlightTerms(entry.heading, terms))
    }
    const excerpt = document.createElement('span')
    excerpt.className = 'result-excerpt'
    excerpt.append(highlightTerms(searchExcerpt(entry, terms), terms))
    a.append(path, excerpt)
    li.appendChild(a)
    searchResults.appendChild(li)
  }
  setActiveResult(0)
}

function openSearch() {
  searchOverlay.classList.add('open')
  document.body.style.overflow = 'hidden'
  searchInput.focus()
  searchInput.select()
  void ensureSearchIndex()
  renderSearchResults()
}

function closeSearch() {
  searchOverlay.classList.remove('open')
  document.body.style.overflow = ''
  // The hidden input can keep focus — then the `/` shortcut's typing-target
  // guard would swallow the very key meant to reopen the search.
  searchInput.blur()
}

searchInput.addEventListener('input', renderSearchResults)
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    setActiveResult(activeResult + 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    setActiveResult(activeResult - 1)
  } else if (e.key === 'Enter') {
    searchResults.querySelectorAll('a')[activeResult]?.click()
  }
})

// A click on a result navigates natively; closing too covers the SAME-page
// case (hash-only navigation — no reload, the modal would just stay up).
searchResults.addEventListener('click', (e) => {
  if (e.target.closest('a')) closeSearch()
})
searchOverlay.querySelector('.search-close').addEventListener('click', closeSearch)
// mousedown, not click: a text-selection drag from the panel out to the
// backdrop must not close the search.
searchOverlay.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.search-panel')) closeSearch()
})
document.querySelector('.topbar-search')?.addEventListener('click', openSearch)

const isTypingTarget = (t) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault() // the browser would focus its own address/search bar
    if (searchOverlay.classList.contains('open')) closeSearch()
    else openSearch()
  } else if (e.key === 'Escape' && searchOverlay.classList.contains('open')) {
    closeSearch()
  } else if (
    e.key === '/' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !searchOverlay.classList.contains('open') &&
    !isTypingTarget(e.target)
  ) {
    e.preventDefault()
    openSearch()
  }
})

// The topbar hint shows the shortcut the visitor's OS actually uses.
if (/mac/i.test(navigator.userAgentData?.platform || navigator.platform || '')) {
  const hint = document.querySelector('.topbar-search kbd')
  if (hint) hint.textContent = '⌘ K'
}

// ── Direct download ──────────────────────────────────────────────────────────
// The topbar Download button starts the right installer immediately — same
// mechanism as the landing page (see main.js), sharing its sessionStorage
// cache so both pages together make at most one GitHub API call per session.
// Fallbacks (unsupported OS, API rate limit, JS off): the static href to the
// landing page, which carries the full download block.
async function initGuideDownload() {
  const btn = document.querySelector('.topbar .btn-primary')
  if (!(btn instanceof HTMLAnchorElement)) return
  const platform = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase()
  const ua = navigator.userAgent.toLowerCase()
  // Which desktop build fits this OS ('' = none: mobile, Linux, anything else).
  const os = /iphone|ipad|android/.test(ua)
    ? ''
    : platform.includes('win') || ua.includes('windows')
      ? 'windows'
      : platform.includes('mac') || ua.includes('mac os')
        ? 'mac'
        : ''
  // Unsupported OS — there's no installer to hand this visitor, so drop the
  // Download button rather than point it at a landing page they can't act on.
  // (A supported OS whose API call fails keeps the button + its static href.)
  if (!os) {
    btn.remove()
    return
  }
  const CACHE_KEY = 'dth-latest-release'
  let release = null
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY))
    if (cached && Date.now() - cached.at < 60 * 60 * 1000) release = cached.release
  } catch {
    /* corrupt cache — refetch */
  }
  if (!release) {
    try {
      const res = await fetch('https://api.github.com/repos/polynaut/dth-character-studio/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (!res.ok) return
      const data = await res.json()
      release = {
        tag: data.tag_name,
        url: data.html_url,
        assets: data.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
      }
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }))
      } catch {
        /* storage full/blocked — fine, just uncached */
      }
    } catch {
      return
    }
  }
  const win = release.assets.find((a) => a.name.endsWith('-setup.exe'))
  const dmgs = release.assets.filter((a) => a.name.endsWith('.dmg'))
  const mac =
    dmgs.find((a) => a.name.includes('universal')) ||
    dmgs.find((a) => a.name.includes('aarch64')) ||
    dmgs[0]
  const asset = os === 'windows' ? win : mac
  if (asset) {
    btn.href = asset.url
    btn.title = `${release.tag} · direct download`
  }
}
void initGuideDownload()
