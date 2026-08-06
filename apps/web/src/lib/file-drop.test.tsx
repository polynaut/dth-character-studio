// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The hook installs ONE Tauri webview listener and drives every zone from it.
// Capture that handler so a test can emit the real event shapes Tauri sends —
// the existing component tests mock this module out wholesale, which left the
// extension filtering (the rule that decides whether a drop is refused) with no
// coverage at all.
type DragEvent =
  | { type: 'enter' | 'over'; paths: Array<string>; position: { x: number; y: number } }
  | { type: 'drop'; paths: Array<string>; position: { x: number; y: number } }
  | { type: 'leave' }

let emit: (payload: DragEvent) => void = () => {}
const setFocus = vi.fn().mockResolvedValue(undefined)

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (handler: (e: { payload: DragEvent }) => void) => {
      emit = (payload) => handler({ payload })
      return Promise.resolve(() => {})
    },
    window: { setFocus },
  }),
}))

const { useFileDrop } = await import('./file-drop.ts')

/** A zone rendered at a known point, with `elementsFromPoint` pointed at it. */
function Zone({
  accept,
  acceptFolders,
  onDrop,
}: {
  accept?: Array<string>
  acceptFolders?: boolean
  onDrop: (paths: Array<string>) => void
}) {
  const { id, isOver } = useFileDrop({ accept, acceptFolders, onDrop })
  return (
    <div data-filedrop-id={id} data-testid="zone">
      {isOver ? 'over' : 'idle'}
    </div>
  )
}

function pointAt(el: Element) {
  // The hook walks the element stack under the cursor. jsdom has no layout AND
  // no `elementsFromPoint` at all (so there is nothing to spy on) — define it
  // outright, returning this one element as the whole stack.
  Object.defineProperty(document, 'elementsFromPoint', {
    configurable: true,
    writable: true,
    value: () => [el],
  })
}

const AT = { x: 10, y: 10 }

describe('useFileDrop extension filtering', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    setFocus.mockClear()
  })

  // Zones register in a MODULE-level map keyed by id; an un-unmounted zone from
  // a previous test would still be hit-testable and steal the next drop.
  afterEach(cleanup)

  it('delivers only the paths whose extension the zone accepts', async () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<Zone accept={['hip', 'hiplc']} onDrop={onDrop} />)
    await waitFor(() => expect(emit).not.toBe(undefined))
    pointAt(getByTestId('zone'))

    emit({ type: 'drop', paths: ['D:/a.fbx', 'D:/b.hiplc', 'D:/c.txt'], position: AT })

    // The mixed drop yields the one Houdini project — which is what makes a
    // `paths[0]` caller safe.
    expect(onDrop).toHaveBeenCalledTimes(1)
    expect(onDrop.mock.calls[0][0]).toEqual(['D:/b.hiplc'])
  })

  it('REFUSES a drop with no accepted extension — onDrop never fires', async () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<Zone accept={['hip', 'hiplc']} onDrop={onDrop} />)
    await waitFor(() => expect(emit).not.toBe(undefined))
    pointAt(getByTestId('zone'))

    emit({ type: 'drop', paths: ['D:/a.fbx', 'D:/b.txt'], position: AT })

    expect(onDrop).not.toHaveBeenCalled()
  })

  it('does not highlight while an unsupported file hovers', async () => {
    const { getByTestId } = render(<Zone accept={['duf']} onDrop={vi.fn()} />)
    await waitFor(() => expect(emit).not.toBe(undefined))
    pointAt(getByTestId('zone'))

    emit({ type: 'enter', paths: ['D:/a.fbx'], position: AT })
    expect(getByTestId('zone').textContent).toBe('idle')

    // ...and does highlight for a supported one, so the refusal is visible
    // BEFORE the user lets go.
    emit({ type: 'enter', paths: ['D:/a.duf'], position: AT })
    await waitFor(() => expect(getByTestId('zone').textContent).toBe('over'))
  })

  it('matches the extension case-insensitively', async () => {
    const onDrop = vi.fn()
    const { getByTestId } = render(<Zone accept={['hiplc']} onDrop={onDrop} />)
    await waitFor(() => expect(emit).not.toBe(undefined))
    pointAt(getByTestId('zone'))

    emit({ type: 'drop', paths: ['D:/Kira.HIPLC'], position: AT })

    expect(onDrop.mock.calls[0][0]).toEqual(['D:/Kira.HIPLC'])
  })

  it('a folder zone takes ANY path — it has no extension to match on', async () => {
    // Deliberate: a folder field resolves whatever it gets (a file means the
    // folder it lives in), and the OS doesn't reveal dir-vs-file during a drag.
    const onDrop = vi.fn()
    const { getByTestId } = render(<Zone acceptFolders onDrop={onDrop} />)
    await waitFor(() => expect(emit).not.toBe(undefined))
    pointAt(getByTestId('zone'))

    emit({ type: 'drop', paths: ['D:/some/folder'], position: AT })
    emit({ type: 'drop', paths: ['D:/notes.txt'], position: AT })

    expect(onDrop.mock.calls[0][0]).toEqual(['D:/some/folder'])
    expect(onDrop.mock.calls[1][0]).toEqual(['D:/notes.txt'])
  })
})
