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
  // The real resolver returns an inline data URL (never a bare filename); mirror
  // that so the <img src> guard in usePortraitSrc lets it through, while still
  // encoding the reference so tests can assert which upload is showing.
  resolveImageSrc: async (image: string) => (image ? `data:image/png;base64,${image}` : ''),
  // Portrait resolves a scene's sibling `.tip.png` through this — same data-URL
  // shape so the staged-scene preview renders instead of throwing on an undefined
  // (unlisted) mock export.
  resolveScenePreview: async (scenePath: string) => (scenePath ? `data:image/png;base64,${scenePath}` : ''),
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
  // jsdom has no object-URL support — a staged crop previews via one.
  URL.createObjectURL = () => 'blob:staged'
  URL.revokeObjectURL = () => {}
})

import { ImageDialog } from './image-dialog'

function pickFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, {
    target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] },
  })
}

async function crop() {
  // Wait for the validated source to open the (stubbed) crop editor, then STAGE it.
  const useCrop = await screen.findByRole('button', { name: 'Use this crop' })
  fireEvent.click(useCrop)
}

/** Hit the dialog's single save action. */
function apply() {
  fireEvent.click(screen.getByRole('button', { name: /Apply/ }))
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

  it('staging a crop persists nothing — only Apply commits; a refused persist never uploads', async () => {
    const onApply = vi.fn(async () => null)
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    pickFile()
    await crop() // stage the cropped square
    expect(onApply).not.toHaveBeenCalled() // ← the crop click saves nothing
    apply()
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(uploadCroppedAvatar).not.toHaveBeenCalled() // refused → the producer never ran
  })

  it('keeps the staged crop (to retry) when the persist fails after the upload ran', async () => {
    const onApply = vi.fn(
      async (produce: () => Promise<{ image: string; imageScene: string }>) => {
        await produce()
        return null
      },
    )
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    pickFile()
    await crop()
    apply()
    await waitFor(() => expect(uploadCroppedAvatar).toHaveBeenCalledTimes(1))
    // A failed persist leaves the dialog open with the staged crop still previewed.
    await waitFor(() => expect(previewSrc()).toBe('blob:staged'))
  })

  it('uploads the crop on Apply and closes on a successful persist', async () => {
    const onClose = vi.fn()
    const onApply = vi.fn(
      async (produce: () => Promise<{ image: string; imageScene: string }>) => await produce(),
    )
    render(<ImageDialog {...baseProps} onApply={onApply} onClose={onClose} />)
    pickFile()
    await crop()
    expect(onApply).not.toHaveBeenCalled()
    apply()
    await waitFor(() => expect(uploadCroppedAvatar).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('re-selects a past upload — staged, then committed on Apply, no re-upload', async () => {
    recentUploads = ['c1--up-200.png', 'c1--up-100.png']
    const onClose = vi.fn()
    const onApply = vi.fn(
      async (produce: () => Promise<{ image: string; imageScene: string }>) => await produce(),
    )
    render(<ImageDialog {...baseProps} onApply={onApply} onClose={onClose} />)
    const buttons = await screen.findAllByRole('button', { name: 'Use this uploaded image' })
    expect(buttons).toHaveLength(2)
    fireEvent.click(buttons[1])
    expect(onApply).not.toHaveBeenCalled() // selecting a recent upload only STAGES it
    await waitFor(() => expect(previewSrc()).toBe('data:image/png;base64,c1--up-100.png'))
    apply()
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(uploadCroppedAvatar).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('staging the primary scene commits with the scene as provenance (imageScene)', async () => {
    // The scene path stages a preview (never persists on select), and Apply copies the
    // scene tip in AND records the scene as the image's provenance — the field the avatar
    // auto-sync keys off. It must NOT run the crop-upload producer.
    let produced: { image: string; imageScene: string } | null = null
    const onClose = vi.fn()
    const onApply = vi.fn(async (produce: () => Promise<{ image: string; imageScene: string }>) => {
      produced = await produce()
      return produced
    })
    render(
      <ImageDialog {...baseProps} scenes={['X:/scenes/Beach.duf']} onApply={onApply} onClose={onClose} />,
    )
    // Pick the primary scene thumbnail (its title is the scene file name).
    fireEvent.click(await screen.findByTitle('Beach.duf'))
    expect(onApply).not.toHaveBeenCalled() // selecting a scene only STAGES it
    apply()
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(produced).toEqual({ image: 'scene-img', imageScene: 'X:/scenes/Beach.duf' })
    expect(uploadCroppedAvatar).not.toHaveBeenCalled() // the scene path uploads no crop
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
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
