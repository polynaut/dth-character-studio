// Guide lightbox: the article shows app screenshots at ~66% of their native
// size (the text column) — clicking one opens it at 100% in an overlay. Click
// anywhere or press Escape to close; tall images scroll inside the overlay.
// On a portrait phone a WIDE image rotates 90° (the video-player recipe) —
// see updateRotation below.

const overlay = document.createElement('div')
overlay.className = 'guide-lightbox'
overlay.setAttribute('role', 'dialog')
overlay.setAttribute('aria-label', 'Screenshot at full size')
document.body.appendChild(overlay)

function close() {
  overlay.classList.remove('open', 'rotated')
  overlay.replaceChildren()
  document.body.style.overflow = ''
}

// Rotation-LOCKED phones never flip the browser to landscape, so turning the
// phone left with the overlay open used to show a tiny sideways-cropped image.
// Instead: a wide image in a portrait PHONE viewport rotates 90° (caption
// included, `.rotated`) to use the screen's long axis — turn the phone left
// and it reads upright, exactly like a fullscreen video. Re-judged on every
// resize, so with auto-rotate ON the viewport itself goes landscape and the
// class simply never applies (nor on desktop/tablet widths).
function updateRotation() {
  const img = overlay.querySelector('img')
  if (!overlay.classList.contains('open') || !img || !img.naturalWidth) return
  const portraitPhone = window.innerWidth <= 640 && window.innerHeight > window.innerWidth
  const wide = img.naturalWidth > img.naturalHeight * 1.2
  overlay.classList.toggle('rotated', portraitPhone && wide)
}
window.addEventListener('resize', updateRotation)

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
  // App screenshots are 2560px @2x → 100% = 1280 CSS px; other images
  // (external photos) open at their natural size. Both stay capped by the
  // stylesheet's max-width against the overlay's CONTENT box — a vw-based
  // inline cap here used to ignore the overlay padding, so on phones the
  // image sat flush against the right edge.
  if (/\/screenshots\//.test(full.src)) full.style.width = 'min(1280px, 100%)'
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
  // Judge rotation now (cached image) and again once the natural size is known.
  updateRotation()
  full.addEventListener('load', updateRotation)
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

// ── Exact sticky-chrome clearance ────────────────────────────────────────────
// Anchors inside a section must land BELOW the docked chapter title, whose
// height varies with viewport width — narrow columns wrap a title to 2-3
// lines, so the stylesheet's fixed scroll-margin (kept as the no-JS fallback)
// hid the target under the taller mobile dock. Measure each section's own h2
// and set the margin per element; re-run before every reveal (fonts swapping
// in can change the h2's height) and on resize (titles rewrap).
function setAnchorClearance() {
  const topbar = document.querySelector('.topbar')?.offsetHeight ?? 72
  for (const section of document.querySelectorAll('.guide-section')) {
    const h2 = section.querySelector('h2')
    if (!h2) continue
    const clearance = `${topbar + h2.offsetHeight + 8}px`
    for (const el of section.querySelectorAll('h3[id], h4[id], h5[id], h6[id], details[id]'))
      el.style.scrollMarginTop = clearance
  }
}
setAnchorClearance()
window.addEventListener('resize', setAnchorClearance)

// Any hash target, not just accordions: local images reserve their space at
// build time (aspect-ratio, build-guide-site.mjs), but the few EXTERNAL images
// (GitHub user-attachments) can still shift layout while they load — this
// re-anchors the visited hash once everything has sized. An accordion target
// additionally gets opened.
function revealHashTarget() {
  const id = decodeURIComponent(location.hash.slice(1))
  const target = id ? document.getElementById(id) : null
  if (!target) return
  const details = target.closest('details')
  if (details) details.open = true
  setAnchorClearance()
  ;(details ?? target).scrollIntoView({ behavior: 'smooth', block: 'start' })
}
window.addEventListener('hashchange', revealHashTarget)
// After load, not DOMContentLoaded — images have sized by then, so the
// scroll target doesn't drift while screenshots stream in.
if (document.readyState === 'complete') revealHashTarget()
else window.addEventListener('load', revealHashTarget)

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
