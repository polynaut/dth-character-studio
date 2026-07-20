/**
 * Global "working" cursor for long-running jobs (asset installs, dedup scans,
 * refresh sweeps, character-folder moves): while at least one wrapped promise
 * is in flight, `<html>` carries the `busy-cursor` class and styles.css shows
 * the OS progress cursor (pointer + spinning ring) everywhere — so "it's
 * working" is visible wherever the mouse happens to be.
 *
 * Counter-based: overlapping jobs release the cursor only when the last one
 * settles. No-ops without a DOM (vitest node runs).
 */
let active = 0

function update() {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('busy-cursor', active > 0)
}

export async function withBusyCursor<T>(work: Promise<T>): Promise<T> {
  active += 1
  update()
  try {
    return await work
  } finally {
    active -= 1
    update()
  }
}
