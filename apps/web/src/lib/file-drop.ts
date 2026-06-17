import { useEffect, useId, useRef, useState } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'

/**
 * Native OS file drag-and-drop, routed to whichever on-screen *pane* the cursor
 * is over — not a precise button.
 *
 * Tauri (with the default `dragDropEnabled`) captures OS drops itself, so HTML5
 * drop events never fire for Explorer files. Instead it emits a single webview
 * drag-drop event stream with physical-pixel cursor positions. We listen once,
 * hit-test the cursor against every registered drop zone (via `elementFromPoint`
 * on the zone's `data-filedrop-id` wrapper), highlight the matching one while a
 * supported file hovers it, and on drop hand its accepted paths to that zone.
 */

interface Zone {
  /** Lower-case extensions (no dot) this zone accepts, e.g. ['duf']. */
  accept: Array<string>
  onDrop: (paths: Array<string>) => void
  setOver: (over: boolean) => void
}

const zones = new Map<string, Zone>()
let listening = false
/** Paths of the in-flight drag (captured on `enter`, reused during `over`). */
let draggedPaths: Array<string> = []
let activeId: string | null = null

/** Lower-case file extension without the dot ('' when none). */
function extOf(path: string): string {
  const match = /\.([^.\\/]+)$/.exec(path)
  return match ? match[1].toLowerCase() : ''
}

/** The id of the registered zone under a physical-pixel cursor position. */
function zoneIdAt(physX: number, physY: number): string | null {
  const dpr = window.devicePixelRatio || 1
  const el = document.elementFromPoint(physX / dpr, physY / dpr)
  return el?.closest('[data-filedrop-id]')?.getAttribute('data-filedrop-id') ?? null
}

function zoneAccepts(zone: Zone, paths: Array<string>): boolean {
  return paths.some((p) => zone.accept.includes(extOf(p)))
}

function setActive(id: string | null) {
  if (activeId === id) return
  if (activeId) zones.get(activeId)?.setOver(false)
  activeId = id
  if (activeId) zones.get(activeId)?.setOver(true)
}

/** Highlight the zone under the cursor iff it accepts the dragged file(s). */
function updateActive(pos: { x: number; y: number }) {
  const id = zoneIdAt(pos.x, pos.y)
  const zone = id ? zones.get(id) : null
  setActive(zone && zoneAccepts(zone, draggedPaths) ? id : null)
}

async function ensureListening() {
  if (listening) return
  listening = true
  try {
    await getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload
      if (p.type === 'enter') {
        draggedPaths = p.paths
        updateActive(p.position)
      } else if (p.type === 'over') {
        updateActive(p.position)
      } else if (p.type === 'drop') {
        const id = zoneIdAt(p.position.x, p.position.y)
        const zone = id ? zones.get(id) : null
        if (zone) {
          const matching = p.paths.filter((path) => zone.accept.includes(extOf(path)))
          if (matching.length) zone.onDrop(matching)
        }
        draggedPaths = []
        setActive(null)
      } else {
        // leave
        draggedPaths = []
        setActive(null)
      }
    })
  } catch {
    // No native webview (web-only build) — drag-drop simply stays inactive.
    listening = false
  }
}

/**
 * Register the calling element as a file drop zone. Returns a stable `id` to put
 * on the wrapper as `data-filedrop-id`, and `isOver` (true while a supported
 * file hovers this zone). The latest `onDrop` is always used without
 * re-registering.
 */
export function useFileDrop(opts: { accept: Array<string>; onDrop: (paths: Array<string>) => void }) {
  const id = useId()
  const [isOver, setIsOver] = useState(false)
  const onDropRef = useRef(opts.onDrop)
  onDropRef.current = opts.onDrop
  const acceptKey = opts.accept.join(',').toLowerCase()

  useEffect(() => {
    zones.set(id, {
      accept: acceptKey ? acceptKey.split(',') : [],
      onDrop: (paths) => onDropRef.current(paths),
      setOver: setIsOver,
    })
    void ensureListening()
    return () => {
      zones.delete(id)
      if (activeId === id) activeId = null
    }
  }, [id, acceptKey])

  return { id, isOver }
}
