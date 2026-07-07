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

import { toast } from 'sonner'

import { NotesEditor } from './notes-editor'
import { NotesConflictError, resolveNoteMedia, saveNotes } from '#/lib/rom/api.ts'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NotesEditor', () => {
  it('loads the stored notes, saves on blur with the loaded mtime, and previews the markdown', async () => {
    render(<NotesEditor projectId="X:/proj" />)
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

    // Preview renders real markdown (heading), not the raw text.
    fireEvent.mouseDown(screen.getByText('Preview'))
    fireEvent.click(screen.getByText('Preview'))
    expect(await screen.findByText('Elyra')).toBeTruthy()
  })

  it('resolves media:// images in the preview via the api', async () => {
    const { fetchNotes } = await import('#/lib/rom/api.ts')
    vi.mocked(fetchNotes).mockResolvedValueOnce({ text: '![ref](media://123-ref.png)', mtime: 5 })
    render(<NotesEditor projectId="X:/proj" />)
    await screen.findByRole('textbox')
    fireEvent.mouseDown(screen.getByText('Preview'))
    fireEvent.click(screen.getByText('Preview'))
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

  it('offers Reload on a conflict, which loads the disk version', async () => {
    const { fetchNotes } = await import('#/lib/rom/api.ts')
    vi.mocked(saveNotes).mockRejectedValueOnce(new NotesConflictError())
    render(<NotesEditor projectId="X:/proj" />)
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
