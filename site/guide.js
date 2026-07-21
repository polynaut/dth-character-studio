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
  if (/iphone|ipad|android/.test(ua)) return
  const os =
    platform.includes('win') || ua.includes('windows')
      ? 'windows'
      : platform.includes('mac') || ua.includes('mac os')
        ? 'mac'
        : ''
  if (!os) return
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
