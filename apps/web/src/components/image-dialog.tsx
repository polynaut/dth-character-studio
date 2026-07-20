import { useRef, useState } from 'react'

import { Avatar } from '#/components/avatar.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { Portrait } from '#/components/portrait.tsx'
import { Button, Input, Modal } from '@dth/ui'
import {
  setAvatarFromScene,
  uploadCharacterImage,
  uploadCharacterImageFromPath,
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
  /** Applies the new stored image reference. `imageScene` is the linked scene
   *  whose preview the image mirrors — '' for uploads and external URLs — so
   *  the caller can persist the provenance the avatar auto-sync keys off. */
  onApply: (image: string, imageScene: string) => void | Promise<void>
  onClose: () => void
}) {
  const [url, setUrl] = useState(image)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  // Native OS drag-drop gives a path — read + upload it server-side.
  async function uploadPath(path: string) {
    setBusy(true)
    setError('')
    try {
      const served = await uploadCharacterImageFromPath({ data: { characterId, path } })
      setUrl(served)
      void onApply(served, '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
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
    setBusy(true)
    setError('')
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
        reader.onerror = () => reject(new Error('Could not read the file'))
        reader.readAsDataURL(file)
      })
      const served = await uploadCharacterImage({
        data: {
          characterId,
          mimeType: file.type,
          dataBase64: dataUrl.split(',')[1] ?? '',
        },
      })
      setUrl(served)
      void onApply(served, '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Switch the avatar to a linked scene's tip thumbnail (copied into the app's
  // images folder). Mirrors the upload handlers — updates the preview + persists.
  async function applyScene(scenePath: string) {
    setBusy(true)
    setError('')
    try {
      const served = await setAvatarFromScene({ data: { characterId, scenePath } })
      setUrl(served)
      await onApply(served, scenePath)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // The Modal primitive carries the dialog semantics the old hand-rolled portal
  // was missing: focus trap, initial focus, ESCAPE (there was none here), and
  // focus restore to the opener.
  return (
    <Modal open onClose={onClose} title="Character image" showClose>
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
            {busy ? 'Uploading…' : 'Drop an image here, or click to pick one'}
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
                void onApply(url, '')
                onClose()
              }
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              void onApply(url, '')
              onClose()
            }}
          >
            Apply
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
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
    </Modal>
  )
}
