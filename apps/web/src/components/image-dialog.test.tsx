// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  bitmapSize = { width: 800, height: 600 }
})

const uploadCroppedAvatar = vi.fn(async () => 'uploaded-img')
vi.mock('#/lib/rom/api.ts', () => ({
  uploadCroppedAvatar: () => uploadCroppedAvatar(),
  readAvatarSourceFile: async () => ({ bytes: new Uint8Array([1]), mimeType: 'image/png' }),
  setAvatarFromScene: async () => 'scene-img',
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
})
