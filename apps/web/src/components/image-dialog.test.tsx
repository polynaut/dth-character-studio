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
  offsetY: 0,
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
      async (produce: () => Promise<{ image: string; imageScene: string; imageOffsetY: number }>) => {
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
      async (produce: () => Promise<{ image: string; imageScene: string; imageOffsetY: number }>) => await produce(),
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
      async (produce: () => Promise<{ image: string; imageScene: string; imageOffsetY: number }>) => await produce(),
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
    let produced: { image: string; imageScene: string; imageOffsetY: number } | null = null
    const onClose = vi.fn()
    const onApply = vi.fn(async (produce: () => Promise<{ image: string; imageScene: string; imageOffsetY: number }>) => {
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
    expect(produced).toEqual({
      image: 'scene-img',
      imageScene: 'X:/scenes/Beach.duf',
      imageOffsetY: 0,
    })
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

/** The vertical framing offset (`character.imageOffsetY`) — staged like every
 *  other selection here and committed by the same single Apply. */
describe('ImageDialog vertical offset', () => {
  const offsetSlider = () => screen.getByRole('slider') as HTMLInputElement

  function commitPatch() {
    let produced: { image: string; imageScene: string; imageOffsetY: number } | null = null
    const onApply = vi.fn(
      async (
        produce: () => Promise<{ image: string; imageScene: string; imageOffsetY: number }>,
      ) => {
        produced = await produce()
        return produced
      },
    )
    return { onApply, read: () => produced }
  }

  it('seeds from the stored offset and commits a dragged value', async () => {
    const { onApply, read } = commitPatch()
    render(<ImageDialog {...baseProps} offsetY={4} onApply={onApply} />)
    expect(offsetSlider().value).toBe('4')
    fireEvent.change(offsetSlider(), { target: { value: '-7.5' } })
    apply()
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(read()?.imageOffsetY).toBe(-7.5)
    // The picture itself is untouched — re-framing is not a re-upload.
    expect(read()?.image).toBe('orig-img')
    expect(uploadCroppedAvatar).not.toHaveBeenCalled()
  })

  it('a changed offset alone is a real change — Apply persists instead of no-oping', async () => {
    const { onApply } = commitPatch()
    const onClose = vi.fn()
    render(<ImageDialog {...baseProps} onApply={onApply} onClose={onClose} />)
    fireEvent.change(offsetSlider(), { target: { value: '6' } })
    apply()
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('an untouched dialog still persists nothing', async () => {
    const { onApply } = commitPatch()
    const onClose = vi.fn()
    render(<ImageDialog {...baseProps} offsetY={4} onApply={onApply} onClose={onClose} />)
    apply()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onApply).not.toHaveBeenCalled()
  })

  it('rides along with a newly picked scene — one Apply, one save', async () => {
    const { onApply, read } = commitPatch()
    render(<ImageDialog {...baseProps} scenes={['X:/scenes/Beach.duf']} onApply={onApply} />)
    fireEvent.click(await screen.findByTitle('Beach.duf'))
    fireEvent.change(offsetSlider(), { target: { value: '9' } })
    apply()
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(read()).toEqual({
      image: 'scene-img',
      imageScene: 'X:/scenes/Beach.duf',
      imageOffsetY: 9,
    })
  })

  it('Reset returns to 0 and is disabled once there', async () => {
    render(<ImageDialog {...baseProps} offsetY={12} onApply={vi.fn(async () => null)} />)
    const reset = screen.getByRole('button', { name: 'Reset' })
    expect(reset).toHaveProperty('disabled', false)
    fireEvent.click(reset)
    expect(offsetSlider().value).toBe('0')
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveProperty('disabled', true)
  })

  it('freezes all three offset controls while the persist is in flight', async () => {
    // A value typed DURING a persist would be silently dropped when the dialog
    // closes on success (the producer captured its offset at commit) — so the
    // box must freeze with the slider and Reset, not stay editable.
    let finish!: (v: null) => void
    const onApply = vi.fn(() => new Promise<null>((r) => (finish = r)))
    render(<ImageDialog {...baseProps} offsetY={4} onApply={onApply} />)
    fireEvent.change(offsetSlider(), { target: { value: '6' } })
    apply()
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(offsetSlider().disabled).toBe(true)
    expect(screen.getByTitle(/Percent of the picture/)).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveProperty('disabled', true)
    finish(null) // let the in-flight persist settle so nothing leaks past the test
    await waitFor(() => expect(offsetSlider().disabled).toBe(false))
  })

  it('clamps a typed value before it is saved — zod would reject anything past ±50', async () => {
    // Asserted on the COMMITTED value, not the slider: the track clamps its own
    // rendering regardless, so reading it back would pass over a missing clamp.
    const { onApply, read } = commitPatch()
    render(<ImageDialog {...baseProps} onApply={onApply} />)
    const box = screen.getByTitle(/Percent of the picture/) as HTMLInputElement
    fireEvent.change(box, { target: { value: '400' } })
    fireEvent.blur(box)
    apply()
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(read()?.imageOffsetY).toBe(25)
  })
})
