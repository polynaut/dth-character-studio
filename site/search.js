// Docs search, shared by the landing page and every guide page (the guide
// build's shell and index.html both load this file). The index is generated at
// build time (guide/search-index.json — one entry per heading section,
// build-guide-site.mjs) and fetched once, when the search first opens. Query
// words AND-match; heading hits rank over page-title hits over body hits;
// every result deep-links to its section's anchor. Opens via the topbar
// button, Ctrl/⌘+K or `/`; ↑/↓ + Enter navigate, Escape closes.

// Guide pages sit NEXT TO the index and link results page-relative; the
// landing page reaches down into guide/.
const SEARCH_BASE = document.body.classList.contains('guide-body') ? '' : 'guide/'

const searchOverlay = document.createElement('div')
searchOverlay.className = 'guide-search'
searchOverlay.innerHTML = `
  <div class="search-panel" role="dialog" aria-modal="true" aria-label="Search the docs">
    <div class="search-box">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="search" placeholder="Search the docs…" aria-label="Search query" autocomplete="off" autocapitalize="off" spellcheck="false" />
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
  searchFetch ??= fetch(`${SEARCH_BASE}search-index.json`)
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
  if (!terms.length) return status('Type to search the docs')
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
    a.href = SEARCH_BASE + (entry.level === 1 ? entry.page : `${entry.page}#${entry.id}`)
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
