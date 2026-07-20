// DTH Character Studio — landing page behaviour.
//
// 1. Sticky topbar: hidden at the top, slides in once the hero title leaves the
//    viewport (IntersectionObserver — no scroll handler).
// 2. OS-aware download: fetches the latest GitHub release, detects the visitor's
//    OS and points the big button at the right asset (.exe / .dmg). The static
//    HTML already links to the releases page, so with JS off — or the API rate
//    limit hit — the button still works, just less specifically.

const REPO = 'polynaut/dth-character-studio';
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const LATEST_URL = `${RELEASES_URL}/latest`;

// --------------------------------------------------------------- Topbar

const topbar = document.getElementById('topbar');
const heroTitle = document.getElementById('hero-title');

new IntersectionObserver(
  ([entry]) => {
    const shown = !entry.isIntersecting;
    topbar.classList.toggle('shown', shown);
    topbar.setAttribute('aria-hidden', String(!shown));
  },
  { rootMargin: '-60px 0px 0px 0px' },
).observe(heroTitle);

// --------------------------------------------------------------- Download

const WINDOWS_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M0 3.449 9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801"/></svg>';

const APPLE_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M16.365 1.43c0 1.14-.493 2.27-1.177 3.08-.744.9-1.99 1.57-2.987 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.572-2.27 1.206-2.98.804-.94 2.142-1.64 3.248-1.68.03.13.05.28.05.43zm4.565 15.71c-.03.07-.463 1.58-1.518 3.12-.945 1.34-1.94 2.71-3.43 2.71-1.517 0-1.9-.88-3.63-.88-1.698 0-2.302.91-3.67.91-1.377 0-2.332-1.26-3.428-2.8-1.287-1.82-2.323-4.63-2.323-7.28 0-4.28 2.797-6.55 5.552-6.55 1.448 0 2.675.95 3.6.95.865 0 2.222-1.01 3.902-1.01.613 0 2.886.06 4.374 2.19-.13.09-2.383 1.37-2.383 4.19 0 3.26 2.854 4.42 2.954 4.45z"/></svg>';

function detectOS() {
  const platform = (navigator.userAgentData?.platform || navigator.platform || '').toLowerCase();
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|android/.test(ua)) return 'mobile';
  if (platform.includes('win') || ua.includes('windows')) return 'windows';
  if (platform.includes('mac') || ua.includes('mac os')) return 'mac';
  return 'other';
}

async function fetchLatestRelease() {
  const CACHE_KEY = 'dth-latest-release';
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY));
    if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.release;
  } catch {
    /* corrupt cache — refetch */
  }
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data = await res.json();
  const release = {
    tag: data.tag_name,
    url: data.html_url,
    assets: data.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
  };
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release }));
  } catch {
    /* storage full/blocked — fine, just uncached */
  }
  return release;
}

function pickAssets(assets) {
  const win = assets.find((a) => a.name.endsWith('-setup.exe'));
  const dmgs = assets.filter((a) => a.name.endsWith('.dmg'));
  const mac =
    dmgs.find((a) => a.name.includes('universal')) ||
    dmgs.find((a) => a.name.includes('aarch64')) ||
    dmgs[0];
  return { win, mac };
}

function macArchLabel(name) {
  if (name.includes('universal')) return 'Universal';
  if (name.includes('aarch64')) return 'Apple Silicon';
  if (name.includes('x64')) return 'Intel';
  return '';
}

const megabytes = (bytes) => `${(bytes / 1048576).toFixed(0)} MB`;

async function initDownload() {
  const btn = document.getElementById('dl-btn');
  const icon = document.getElementById('dl-icon');
  const label = document.getElementById('dl-label');
  const sub = document.getElementById('dl-sub');
  const alt = document.getElementById('dl-alt');
  const topbarBtn = document.getElementById('topbar-dl');

  let release;
  try {
    release = await fetchLatestRelease();
  } catch {
    return; // static fallback (releases page link) stays in place
  }

  const { win, mac } = pickAssets(release.assets);
  const os = detectOS();

  const altParts = [];
  const altLink = (text, href) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

  if (os === 'windows' && win) {
    btn.href = win.url;
    topbarBtn.href = win.url;
    icon.innerHTML = WINDOWS_ICON;
    label.textContent = 'Download for Windows';
    sub.textContent = `${release.tag} · 64-bit installer · ${megabytes(win.size)}`;
    if (mac) altParts.push(altLink(`Also for macOS (${macArchLabel(mac.name)})`, mac.url));
  } else if (os === 'mac' && mac) {
    btn.href = mac.url;
    topbarBtn.href = mac.url;
    icon.innerHTML = APPLE_ICON;
    label.textContent = 'Download for macOS';
    sub.textContent = `${release.tag} · ${macArchLabel(mac.name)} · ${megabytes(mac.size)}`;
    if (win) altParts.push(altLink('Also for Windows', win.url));
  } else {
    // Mobile / Linux / undetectable: keep the releases-page link, name the tag.
    label.textContent = 'Download the latest release';
    sub.textContent =
      os === 'mobile'
        ? `${release.tag} · a desktop app for Windows & macOS`
        : `${release.tag} · for Windows & macOS`;
  }

  altParts.push(altLink('All releases', RELEASES_URL));
  alt.innerHTML = altParts.join(' <span aria-hidden="true">·</span> ');
}

initDownload();
