// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('#/lib/rom/api.ts', () => ({
  fetchNotes: vi.fn().mockResolvedValue('# Elyra\n\nRaised in the wastes.'),
  saveNotes: vi.fn().mockResolvedValue(undefined),
  addNoteMedia: vi.fn().mockResolvedValue({
    fileName: '123-ref.png',
    markdown: '![ref](media://123-ref.png)',
  }),
  resolveNoteMedia: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
  openNoteMedia: vi.fn(),
}))
vi.mock('#/lib/desktop.ts', () => ({ openExternal: vi.fn() }))

import { NotesEditor } from './notes-editor'
import { resolveNoteMedia, saveNotes } from '#/lib/rom/api.ts'

afterEach(cleanup)

describe('NotesEditor', () => {
  it('loads the stored notes, saves on blur, and previews the markdown', async () => {
    render(<NotesEditor projectId="X:/proj" />)
    const area = await screen.findByRole('textbox')
    await waitFor(() =>
      expect((area as HTMLTextAreaElement).value).toContain('Raised in the wastes.'),
    )

    // Edit + blur → persisted immediately (no debounce wait).
    fireEvent.change(area, { target: { value: '# Elyra\n\nNew backstory.' } })
    fireEvent.blur(area)
    await waitFor(() =>
      expect(saveNotes).toHaveBeenCalledWith({
        data: { projectId: 'X:/proj', characterId: undefined, text: '# Elyra\n\nNew backstory.' },
      }),
    )

    // Preview renders real markdown (heading), not the raw text.
    fireEvent.mouseDown(screen.getByText('Preview'))
    fireEvent.click(screen.getByText('Preview'))
    expect(await screen.findByText('Elyra')).toBeTruthy()
  })

  it('resolves media:// images in the preview via the api', async () => {
    const { fetchNotes } = await import('#/lib/rom/api.ts')
    vi.mocked(fetchNotes).mockResolvedValueOnce('![ref](media://123-ref.png)')
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
})
