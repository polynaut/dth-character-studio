import { useRef, useState } from 'react'

import { Avatar } from '#/components/avatar.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { ImageCropEditor } from '#/components/image-crop-editor.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { Button, Input, Modal } from '@dth/ui'
import { validateAvatarSource } from '#/lib/image-crop.ts'
import {
  readAvatarSourceFile,
  setAvatarFromScene,
  uploadCroppedAvatar,
} from '#/lib/rom/api.ts'

/**
 * Avatar edit dialog: shows the current image, accepts an external image URL,
 * or a drag-and-dropped (or picked) image file which is stored under
 * <data>/images/ and referenced by filename (see lib/rom/image).
 */
export function ImageDialog({
  image,
  name,
  characterId,
  scenes,
  onApply,
  onClose,
}: {
  image: string
  name: string
  characterId: string
  /** Linked Daz scene paths — each offers its `.tip.png` as a pickable avatar. */
  scenes: Array<string>
  /** Persists a new stored image reference. Receives an async PRODUCER of
   *  `{ image, imageScene }` (`imageScene` is the linked scene whose preview
   *  the image mirrors — '' for uploads and external URLs — the provenance the
   *  avatar auto-sync keys off). The caller must run the producer through the
   *  page's persist primitive, e.g.
   *  `onApply={(produce) => draft.persistPatch(produce, { toast: '…' })}`,
   *  so the upload side effect only runs AFTER its single-flight/validate
   *  guards (the daz-scene-field applyAdd pattern), and once it HAS run the
   *  uploaded file is never stranded: interim edits that invalidate the merged
   *  draft don't refuse the persist — the image patch alone still persists,
   *  with those edits kept dirty. Resolves to the persisted result, or `null`
   *  when the persist was refused up front or failed — the dialog then resets
   *  its preview to the last persisted image. */
  onApply: (
    produce: () => Promise<{ image: string; imageScene: string }>,
  ) => Promise<object | null>
  onClose: () => void
}) {
  const [url, setUrl] = useState(image)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** A decoded, size-validated upload awaiting its 1:1 crop. */
  const [cropSource, setCropSource] = useState<ImageBitmap | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  // Every custom upload goes through decode → size validation (256..1024 on
  // both sides) → the 1:1 crop editor; only the CROPPED square is ever stored
  // (so previews render consistently everywhere). Decoding and validating are
  // side-effect free and run up front — the actual write waits inside the
  // persist producer (see applyCrop).
  async function startCrop(blob: Blob) {
    setBusy(true)
    setError('')
    try {
      let bitmap: ImageBitmap
      try {
        bitmap = await createImageBitmap(blob)
      } catch {
        throw new Error('Could not read that image.')
      }
      const problem = validateAvatarSource(bitmap.width, bitmap.height)
      if (problem) {
        bitmap.close()
        throw new Error(problem)
      }
      setCropSource(bitmap)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Native OS drag-drop gives a path — the lib layer reads the bytes (extension
  // allowlist + byte cap live there), then the same decode/validate/crop flow.
  async function uploadPath(path: string) {
    setBusy(true)
    setError('')
    try {
      const { bytes, mimeType } = await readAvatarSourceFile({ data: { path } })
      // Copy into a fresh ArrayBuffer-backed view — the plugin-fs Uint8Array is
      // typed over ArrayBufferLike, which BlobPart no longer accepts directly.
      await startCrop(new Blob([new Uint8Array(bytes)], { type: mimeType }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  async function uploadFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('Not an image file.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image is larger than 10 MB.')
      return
    }
    await startCrop(file)
  }

  // The crop editor produced the final square PNG — store it. The write runs
  // INSIDE the persist producer — after persistPatch's single-flight and
  // validation guards — so an up-front refusal can never have already written
  // the file; once the upload HAS run, the hook persists at least the image
  // patch itself, so the preview never shows an avatar that failed to persist
  // (only a genuinely failed save resets it below).
  async function applyCrop(png: Uint8Array) {
    setBusy(true)
    setError('')
    // Leave the crop step either way — a refused/failed persist returns to the
    // main view with the avatar preview reset (and any error shown); a success
    // shows the new avatar. Either way the staged bitmap is done.
    cropSource?.close()
    setCropSource(null)
    try {
      const saved = await onApply(async () => {
        const served = await uploadCroppedAvatar({ data: { characterId, bytes: png } })
        setUrl(served)
        return { image: served, imageScene: '' }
      })
      // Refused or failed → reset the preview to the last persisted image.
      if (saved === null) setUrl(image)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Switch the avatar to a linked scene's tip thumbnail (copied into the app's
  // images folder). Mirrors the upload handlers — the copy runs inside the
  // persist producer, and the preview resets when the persist is refused.
  async function applyScene(scenePath: string) {
    setBusy(true)
    setError('')
    try {
      const saved = await onApply(async () => {
        const served = await setAvatarFromScene({ data: { characterId, scenePath } })
        setUrl(served)
        return { image: served, imageScene: scenePath }
      })
      if (saved === null) setUrl(image)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function cancelCrop() {
    cropSource?.close()
    setCropSource(null)
    setError('')
  }

  // The Modal primitive carries the dialog semantics the old hand-rolled portal
  // was missing: focus trap, initial focus, ESCAPE (there was none here), and
  // focus restore to the opener.
  return (
    <Modal
      open
      onClose={() => {
        cropSource?.close()
        onClose()
      }}
      title={cropSource ? 'Crop to a square' : 'Character image'}
      showClose
    >
      {/* Once an upload is staged, the dialog becomes the crop step — only the
          cropped square is ever stored, so every avatar preview is 1:1. */}
      {cropSource ? (
        <ImageCropEditor
          bitmap={cropSource}
          busy={busy}
          onApply={(png) => void applyCrop(png)}
          onCancel={cancelCrop}
        />
      ) : (
        <>
        <div className="flex justify-center">
          <Avatar
            image={url}
            name={name}
            className="size-40 rounded-lg"
            fallbackClassName="text-5xl"
          />
        </div>

        <FileDropZone
          accept={['png', 'jpg', 'jpeg', 'webp', 'gif']}
          onDrop={(paths) => paths[0] && void uploadPath(paths[0])}
          label="Drop image to set the avatar"
          className="rounded-lg"
        >
          {/* A real button, so the pick-a-file target works from the keyboard
              (it was a click-only div). */}
          <button
            type="button"
            className="flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-input px-4 py-6 text-center text-sm text-muted-foreground transition-colors hover:border-primary"
            onClick={() => fileInput.current?.click()}
          >
            {busy ? 'Reading…' : 'Drop an image here, or click to pick one'}
            <span className="mt-1 text-xs text-muted-foreground/70">
              256–1024px, any shape — you&rsquo;ll crop it to a square
            </span>
          </button>
        </FileDropZone>

        {/* Offer the linked scenes' thumbnails whenever there's at least one — the
            current avatar may have come from a scene since unlinked, so even a
            single remaining scene needs to be selectable to switch back to it. */}
        {scenes.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm text-muted-foreground">
              {scenes.length === 1 ? "Or use the linked Daz scene's image:" : "Or use a linked Daz scene's image:"}
            </p>
            <div className="flex flex-wrap gap-2">
              {scenes.map((scene) => (
                <button
                  key={scene}
                  type="button"
                  disabled={busy}
                  onClick={() => void applyScene(scene)}
                  title={scene.split(/[\\/]/).pop()}
                  className="rounded-md ring-2 ring-transparent transition hover:ring-primary focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50"
                >
                  <Portrait
                    scenePath={scene}
                    name={name}
                    className="aspect-[3/4] w-16 rounded-md"
                    fallbackClassName="text-lg"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            value={url}
            placeholder="Paste an image URL (https://…)"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // No upload side effect for a URL — the producer just hands the
                // patch over. The dialog closes right away; a refused persist
                // surfaces via persistPatch's own toast.
                void onApply(async () => ({ image: url, imageScene: '' }))
                onClose()
              }
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              void onApply(async () => ({ image: url, imageScene: '' }))
              onClose()
            }}
          >
            Apply
          </Button>
        </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void uploadFile(file)
          e.target.value = ''
        }}
      />
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Modal>
  )
}
