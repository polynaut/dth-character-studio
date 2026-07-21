// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('#/lib/rom/api.ts', () => ({
  fetchNotes: vi.fn().mockResolvedValue({ text: '# Elyra\n\nRaised in the wastes.', mtime: 111 }),
  saveNotes: vi.fn().mockResolvedValue(222),
  addNoteMedia: vi.fn().mockResolvedValue({
    fileName: '123-ref.png',
    markdown: '![ref](media://123-ref.png)',
  }),
  resolveNoteMedia: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
  openNoteMedia: vi.fn(),
  NotesConflictError: class NotesConflictError extends Error {},
}))
vi.mock('#/lib/desktop.ts', () => ({ openExternal: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
// The drop-zone hook registers Tauri webview listeners (inert in jsdom) — the
// mock also hands the tests the zone's onDrop so they can simulate an OS drop.
let dropHandler: ((paths: Array<string>) => void) | undefined
vi.mock('#/lib/file-drop.ts', () => ({
  useFileDrop: (opts: { onDrop: (paths: Array<string>) => void }) => {
    dropHandler = opts.onDrop
    return { id: 'zone', isOver: false }
  },
}))

import { toast } from 'sonner'

import { NotesEditor } from './notes-editor'
import { addNoteMedia, NotesConflictError, resolveNoteMedia, saveNotes } from '#/lib/rom/api.ts'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NotesEditor', () => {
  it('loads the stored notes, saves on blur with the loaded mtime, and renders by default', async () => {
    render(<NotesEditor projectId="X:/proj" />)
    // Rendered markdown IS the default view - the heading proves real markdown.
    expect(await screen.findByText('Elyra')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Edit notes'))
    const area = await screen.findByRole('textbox')
    await waitFor(() =>
      expect((area as HTMLTextAreaElement).value).toContain('Raised in the wastes.'),
    )

    // Edit + blur → persisted immediately (no debounce wait), guarded by the
    // mtime the load returned.
    fireEvent.change(area, { target: { value: '# Elyra\n\nNew backstory.' } })
    fireEvent.blur(area)
    await waitFor(() =>
      expect(saveNotes).toHaveBeenCalledWith({
        data: {
          projectId: 'X:/proj',
          characterId: undefined,
          text: '# Elyra\n\nNew backstory.',
          expectedMtime: 111,
        },
      }),
    )

    // A second save carries the mtime the FIRST save returned.
    fireEvent.change(area, { target: { value: '# Elyra\n\nNewer still.' } })
    fireEvent.blur(area)
    await waitFor(() =>
      expect(saveNotes).toHaveBeenLastCalledWith({
        data: {
          projectId: 'X:/proj',
          characterId: undefined,
          text: '# Elyra\n\nNewer still.',
          expectedMtime: 222,
        },
      }),
    )

    // Done returns to the rendered view.
    fireEvent.click(screen.getByText('Done'))
    expect(await screen.findByText('Elyra')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('resolves media:// images in the default rendered view via the api', async () => {
    const { fetchNotes } = await import('#/lib/rom/api.ts')
    vi.mocked(fetchNotes).mockResolvedValueOnce({ text: '![ref](media://123-ref.png)', mtime: 5 })
    render(<NotesEditor projectId="X:/proj" />)
    await waitFor(() =>
      expect(resolveNoteMedia).toHaveBeenCalledWith({
        data: { projectId: 'X:/proj', fileName: '123-ref.png' },
      }),
    )
    const img = await screen.findByRole('img')
    expect(img.getAttribute('src')).toContain('data:image/png')
  })

  it('toasts a save failure once per burst, not once per save', async () => {
    vi.mocked(saveNotes)
      .mockRejectedValueOnce(new Error('disk full'))
      .mockRejectedValueOnce(new Error('disk full'))
    render(<NotesEditor projectId="X:/proj" />)
    fireEvent.click(await screen.findByLabelText('Edit notes'))
    const area = await screen.findByRole('textbox')

    fireEvent.change(area, { target: { value: 'a' } })
    fireEvent.blur(area)
    await waitFor(() => expect(saveNotes).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Save failed')).toBeTruthy()

    // Still failing → no second toast for the same burst.
    fireEvent.change(area, { target: { value: 'ab' } })
    fireEvent.blur(area)
    await waitFor(() => expect(saveNotes).toHaveBeenCalledTimes(2))
    expect(toast.error).toHaveBeenCalledTimes(1)

    // A success ends the burst; the next failure toasts again.
    fireEvent.change(area, { target: { value: 'abc' } })
    fireEvent.blur(area)
    await waitFor(() => expect(screen.getByText('Saved')).toBeTruthy())
    vi.mocked(saveNotes).mockRejectedValueOnce(new Error('disk full'))
    fireEvent.change(area, { target: { value: 'abcd' } })
    fireEvent.blur(area)
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2))
  })

  it('splices dropped media into the text typed DURING the copy, not the drop-time snapshot', async () => {
    // The media copy hangs until we resolve it — the window in which the bug lived.
    let finishCopy!: (v: { fileName: string; markdown: string }) => void
    vi.mocked(addNoteMedia).mockImplementationOnce(
      () => new Promise((resolve) => (finishCopy = resolve)),
    )
    render(<NotesEditor projectId="X:/proj" />)
    fireEvent.click(await screen.findByLabelText('Edit notes'))
    const area = (await screen.findByRole('textbox')) as HTMLTextAreaElement
    await waitFor(() => expect(area.value).toContain('Raised in the wastes.'))

    // Drop a file (the copy is now in flight), then keep typing.
    act(() => dropHandler!(['C:/shots/ref.png']))
    fireEvent.change(area, {
      target: { value: '# Elyra\n\nRaised in the wastes. Typed during the copy.' },
    })

    await act(async () => {
      finishCopy({ fileName: '123-ref.png', markdown: '![ref](media://123-ref.png)' })
    })
    // The insert built on the CURRENT text — the typing survives, plus the tag
    // (the old code spliced into the drop-time snapshot, reverting the typing).
    await waitFor(() => expect(area.value).toContain('![ref](media://123-ref.png)'))
    expect(area.value).toContain('Raised in the wastes. Typed during the copy.')
  })

  it('surfaces a failed initial load with Retry instead of a dead disabled editor', async () => {
    const { fetchNotes } = await import('#/lib/rom/api.ts')
    vi.mocked(fetchNotes).mockRejectedValueOnce(new Error('share offline'))
    render(<NotesEditor projectId="X:/proj" />)
    expect(await screen.findByText(/share offline/)).toBeTruthy()

    // Retry re-runs the load (the mock succeeds now) → the normal rendered view.
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByText('Elyra')).toBeTruthy()
    expect(screen.queryByText(/share offline/)).toBeNull()
  })

  it('offers Reload on a conflict, which loads the disk version', async () => {
    const { fetchNotes } = await import('#/lib/rom/api.ts')
    vi.mocked(saveNotes).mockRejectedValueOnce(new NotesConflictError())
    render(<NotesEditor projectId="X:/proj" />)
    fireEvent.click(await screen.findByLabelText('Edit notes'))
    const area = await screen.findByRole('textbox')

    fireEvent.change(area, { target: { value: 'my local draft' } })
    fireEvent.blur(area)
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    const [message, options] = vi.mocked(toast.error).mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ]
    expect(message).toContain('another window')
    expect(options.action.label).toBe('Reload')

    // Reload discards the draft in favour of the disk version + its mtime.
    vi.mocked(fetchNotes).mockResolvedValueOnce({ text: 'the other window won', mtime: 333 })
    await act(async () => {
      options.action.onClick()
    })
    await waitFor(() =>
      expect((area as HTMLTextAreaElement).value).toBe('the other window won'),
    )
    fireEvent.change(area, { target: { value: 'the other window won!' } })
    fireEvent.blur(area)
    await waitFor(() =>
      expect(saveNotes).toHaveBeenLastCalledWith({
        data: {
          projectId: 'X:/proj',
          characterId: undefined,
          text: 'the other window won!',
          expectedMtime: 333,
        },
      }),
    )
  })
})
