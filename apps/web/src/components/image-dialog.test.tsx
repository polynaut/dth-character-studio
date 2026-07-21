// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  bitmapSize = { width: 800, height: 600 }
  recentUploads = []
})

const uploadCroppedAvatar = vi.fn(async () => 'uploaded-img')
const deleteCharacterUpload = vi.fn(async () => {})
let recentUploads: Array<string> = []
vi.mock('#/lib/rom/api.ts', () => ({
  uploadCroppedAvatar: () => uploadCroppedAvatar(),
  readAvatarSourceFile: async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' }),
  setAvatarFromScene: async () => 'scene-img',
  listCharacterUploads: async () => recentUploads,
  deleteCharacterUpload: () => deleteCharacterUpload(),
  // Avatar resolves the stored reference asynchronously — identity is enough here.
  resolveImageSrc: async (image: string) => image,
}))
// The drop-zone hook registers Tauri webview listeners — inert in jsdom.
vi.mock('#/lib/file-drop.ts', () => ({ useFileDrop: () => ({ id: 1, isOver: false }) }))

// Stub the canvas crop editor: jsdom has no canvas. Its ONLY contract with the
// dialog is `onApply(pngBytes)`, so expose a button that fires it — the crop
// math itself is unit-tested in lib/image-crop.test.ts.
vi.mock('#/components/image-crop-editor.tsx', () => ({
  ImageCropEditor: ({ onApply }: { onApply: (png: Uint8Array) => void }) => (
    <button type="button" onClick={() => onApply(new Uint8Array([1, 2, 3]))}>
      Use this crop
    </button>
  ),
}))

// createImageBitmap isn't in jsdom — drive validation via this size.
let bitmapSize = { width: 800, height: 600 }
beforeAll(() => {
  vi.stubGlobal('createImageBitmap', async () => ({
    width: bitmapSize.width,
    height: bitmapSize.height,
    close: () => {},
  }))
})

import { ImageDialog } from './image-dialog'

function pickFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
  })
}

async function crop() {
  // Wait for the validated source to open the (stubbed) crop editor, then apply.
  const useCrop = await screen.findByRole('button', { name: 'Use this crop' })
  fireEvent.click(useCrop)
}

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

describe('ImageDialog crop + persist flow', () => {
  it('rejects an image smaller than 256px on either side before any crop', async () => {
    bitmapSize = { width: 200, height: 800 }
    const onApply = vi.fn(async () => null)
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    pickFile()
    await screen.findByText(/too small/)
    expect(screen.queryByRole('button', { name: 'Use this crop' })).toBeNull()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('rejects an image larger than 2048px on either side', async () => {
    bitmapSize = { width: 3000, height: 500 }
    const onApply = vi.fn(async () => null)
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    pickFile()
    await screen.findByText(/too large/)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('runs the upload only inside the persist producer — a refused persist never uploads', async () => {
    const onApply = vi.fn(async () => null)
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    pickFile()
    await crop()
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(uploadCroppedAvatar).not.toHaveBeenCalled()
    await waitFor(() => expect(previewSrc()).toBe('orig-img'))
  })

  it('resets the preview when the persist fails after the upload ran', async () => {
    const onApply = vi.fn(
      async (produce: () => Promise<{ image: string; imageScene: string }>) => {
        await produce()
        return null
      },
    )
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    pickFile()
    await crop()
    await waitFor(() => expect(uploadCroppedAvatar).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(previewSrc()).toBe('orig-img'))
  })

  it('keeps the cropped preview when the persist succeeds', async () => {
    const onApply = vi.fn(
      async (produce: () => Promise<{ image: string; imageScene: string }>) => await produce(),
    )
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    pickFile()
    await crop()
    await waitFor(() => expect(uploadCroppedAvatar).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(previewSrc()).toBe('uploaded-img'))
  })

  it('offers past uploads and re-selects one without re-uploading', async () => {
    recentUploads = ['c1--up-200.png', 'c1--up-100.png']
    const onApply = vi.fn(
      async (produce: () => Promise<{ image: string; imageScene: string }>) => await produce(),
    )
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    // The gallery loads on open (both past uploads shown).
    const buttons = await screen.findAllByRole('button', { name: 'Use this uploaded image' })
    expect(buttons).toHaveLength(2)
    // Clicking one persists that reference — no crop, no upload command.
    fireEvent.click(buttons[1])
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(uploadCroppedAvatar).not.toHaveBeenCalled()
    await waitFor(() => expect(previewSrc()).toBe('c1--up-100.png'))
  })

  it('deletes a past upload but disables the ✕ on the active image', async () => {
    // The active avatar is the first upload; its delete must be disabled.
    recentUploads = ['orig-img', 'c1--up-100.png']
    const onApply = vi.fn(async () => null)
    render(<ImageDialog {...baseProps} image="orig-img" onApply={onApply} />)
    const dels = await screen.findAllByRole('button', { name: 'Delete this upload' })
    expect(dels).toHaveLength(2)
    expect(dels[0]).toHaveProperty('disabled', true) // active image
    expect(dels[1]).toHaveProperty('disabled', false)
    fireEvent.click(dels[1])
    await waitFor(() => expect(deleteCharacterUpload).toHaveBeenCalledTimes(1))
    // Removed from the gallery; the active one remains.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Delete this upload' })).toHaveLength(1),
    )
  })
})
