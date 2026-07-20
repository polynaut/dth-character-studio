// Guide lightbox: the article shows app screenshots at 75% of their native
// size — clicking one opens it at 100% in an overlay. Click anywhere or press
// Escape to close; tall images scroll inside the overlay.

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
  overlay.replaceChildren(full)
  overlay.classList.add('open')
  document.body.style.overflow = 'hidden'
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && overlay.classList.contains('open')) close()
})
