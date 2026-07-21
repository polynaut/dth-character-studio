// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const uploadCharacterImage = vi.fn(async () => 'uploaded-img')
vi.mock('#/lib/rom/api.ts', () => ({
  uploadCharacterImage: () => uploadCharacterImage(),
  uploadCharacterImageFromPath: async () => 'uploaded-img',
  setAvatarFromScene: async () => 'scene-img',
  // Avatar resolves the stored reference asynchronously — identity is enough here.
  resolveImageSrc: async (image: string) => image,
}))
// The drop-zone hook registers Tauri webview listeners — inert in jsdom.
vi.mock('#/lib/file-drop.ts', () => ({ useFileDrop: () => ({ id: 1, isOver: false }) }))

import { ImageDialog } from './image-dialog'

function pickFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
  })
}

/** The Avatar preview's current src (null while the async resolve is pending). */
function previewSrc(): string | null {
  return document.querySelector('img')?.getAttribute('src') ?? null
}

const baseProps = {
  image: 'orig-img',
  name: 'Vic',
  characterId: 'c1',
  scenes: [],
  onClose: () => {},
}

describe('ImageDialog persist flow', () => {
  it('runs the upload only inside the persist producer — a refused persist never uploads', async () => {
    // persistPatch refusing up front (save in flight / invalid draft) resolves
    // null WITHOUT running the producer — the old flow had already written the
    // image file by this point.
    const onApply = vi.fn(async () => null)
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    pickFile()
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(uploadCharacterImage).not.toHaveBeenCalled()
    // The preview never left the persisted image.
    await waitFor(() => expect(previewSrc()).toBe('orig-img'))
  })

  it('resets the preview when the persist fails after the upload ran', async () => {
    // persistPatch runs the producer (upload happens, preview switches), then
    // the save itself fails → it rolls back and resolves null.
    const onApply = vi.fn(
      async (produce: () => Promise<{ image: string; imageScene: string }>) => {
        await produce()
        return null
      },
    )
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    pickFile()
    await waitFor(() => expect(uploadCharacterImage).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(previewSrc()).toBe('orig-img'))
  })

  it('keeps the uploaded preview when the persist succeeds', async () => {
    const onApply = vi.fn(
      async (produce: () => Promise<{ image: string; imageScene: string }>) => await produce(),
    )
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    pickFile()
    await waitFor(() => expect(uploadCharacterImage).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(previewSrc()).toBe('uploaded-img'))
  })
})
