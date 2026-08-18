import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

import { Avatar } from '#/components/avatar.tsx'
import { FileDropZone } from '#/components/file-drop-zone.tsx'
import { ImageCropEditor } from '#/components/image-crop-editor.tsx'
import { Portrait, usePortraitSrc } from '#/components/portrait.tsx'
import { Button, Input, Label, Modal, NumberField } from '@dth/ui'
import { validateAvatarSource } from '#/lib/image-crop.ts'
import {
  deleteCharacterUpload,
  listCharacterUploads,
  readAvatarSourceFile,
  setAvatarFromScene,
  uploadCroppedAvatar,
} from '#/lib/rom/api.ts'

/**
 * How far the vertical-offset control lets the picture travel, as a % of itself.
 * The core schema tolerates ±50 — this is the range that is USEFUL: the header
 * portrait shows about 87% of the square's height, so ±25 already runs a shift
 * off either end of it. Keeping the control inside its own sane range means a
 * typed number can be clamped here instead of being rejected by zod at save.
 */
const OFFSET_LIMIT = 25

/** The header pan's resting `translateY` (`dth-avatar-pan`'s `from`, styles.css). */
const HEADER_REST_PAN = 11

/**
 * The picture as the CHARACTER HEADER frames it — the preview the offset is
 * tuned against, because that portrait is the biggest and most-looked-at crop
 * of it in the app.
 *
 * The geometry is editor-header's, re-expressed as PERCENTAGES so it holds at
 * any preview width: the header lays a 254px square image inside a 168×224
 * frame (164×220 of content) at `-45px` margins — 254/164 = 154.9% of the
 * content box, offset by −45/164 = −27.4% of it. One number does both edges
 * because a margin percentage resolves against the containing block's WIDTH,
 * top margin included.
 *
 * The character's offset ADDS straight onto the resting pan here, which is what
 * the header itself paints at rest: there the two live in different transform
 * slots (see lib/avatar-offset) but its zoom rests at exactly 1, so the sum is
 * the same. Below a preview this small the distinction has nothing to show.
 *
 * Kept in step with editor-header + styles.css BY HAND — retune the numbers
 * together, or this dialog starts lying about the framing it is selling.
 */
function HeaderFramePreview({
  src,
  name,
  offsetY,
}: {
  src: string
  name: string
  offsetY: number
}) {
  return (
    <div className="aspect-[3/4] w-[120px] shrink-0 overflow-hidden rounded-lg border-2 border-[#2d2d2d] bg-[#262626]">
      {src ? (
        <img
          src={src}
          alt=""
          style={{ transform: `translateY(${HEADER_REST_PAN + offsetY}%)` }}
          className="aspect-square w-[154.9%] max-w-none -ml-[27.4%] -mt-[27.4%] object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center bg-muted text-5xl font-bold text-muted-foreground">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  )
}

/**
 * Avatar edit dialog: shows the current image, accepts an external image URL,
 * or a drag-and-dropped (or picked) image file which is stored under
 * <data>/images/ and referenced by filename (see lib/rom/image).
 *
 * It also owns the character's VERTICAL FRAMING offset (`imageOffsetY`): Daz
 * frames a figure in the `.tip.png` it renders according to how tall that
 * figure is, so a short or tall character comes out sitting high or low in the
 * square and every crop of it in the app misses the face by the same amount.
 * One number fixes all of them at once — see lib/avatar-offset.
 */
export function ImageDialog({
  image,
  offsetY,
  name,
  characterId,
  scenes,
  onApply,
  onClose,
}: {
  image: string
  /** The character's stored `imageOffsetY` — seeds the offset control. */
  offsetY: number
  name: string
  characterId: string
  /** The PRIMARY Daz scene (as a 0-or-1 array), offering its `.tip.png` as a
   *  pickable avatar. Only the primary is selectable — a non-primary scene
   *  can be previewed in the header but never set as the stored avatar. */
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
    produce: () => Promise<{ image: string; imageScene: string; imageOffsetY: number }>,
  ) => Promise<object | null>
  onClose: () => void
}) {
  const [url, setUrl] = useState(image)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** A decoded, size-validated upload awaiting its 1:1 crop. */
  const [cropSource, setCropSource] = useState<ImageBitmap | null>(null)
  /** Past uploads (newest first) offered for one-click re-selection. */
  const [recent, setRecent] = useState<Array<string>>([])
  // A selection is STAGED, not persisted, until Apply. A picked scene (previewed
  // from its .tip) or a freshly-cropped upload (previewed from its own bytes) sit
  // here; a recent upload / pasted URL just moves `url`. Apply commits the winner.
  const [stagedScene, setStagedScene] = useState<string | null>(null)
  const [stagedCrop, setStagedCrop] = useState<{ png: Uint8Array; previewUrl: string } | null>(null)
  // The framing offset is staged the same way — Apply commits it with whatever
  // image is selected, so picking a new image and re-framing it is ONE save.
  const [offset, setOffset] = useState(offsetY)
  const fileInput = useRef<HTMLInputElement>(null)

  // The selection resolved to a loadable URL for the header-frame preview. A
  // staged crop is previewed from its own bytes and needs no resolution; the
  // hook still runs (unconditionally, as it must) against an empty selection.
  const resolvedPreview = usePortraitSrc({
    image: stagedCrop || stagedScene ? '' : url,
    scenePath: stagedScene ?? '',
  })
  const previewSrc = stagedCrop?.previewUrl ?? resolvedPreview

  // Load the recent-uploads gallery on open and after each new upload lands.
  useEffect(() => {
    let active = true
    listCharacterUploads({ data: { characterId } })
      .then((list) => active && setRecent(list))
      .catch(() => active && setRecent([]))
    return () => {
      active = false
    }
  }, [characterId, url])

  // Free a staged crop's object URL when it's replaced or the dialog unmounts.
  useEffect(() => {
    const staged = stagedCrop
    return () => {
      if (staged) URL.revokeObjectURL(staged.previewUrl)
    }
  }, [stagedCrop])

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

  // The crop editor produced the final square PNG — STAGE it (previewed from its
  // own bytes). Nothing is uploaded until Apply commits.
  function stageCrop(png: Uint8Array) {
    cropSource?.close()
    setCropSource(null)
    setStagedScene(null)
    // Copy into a fresh ArrayBuffer-backed view so it's a valid BlobPart (see uploadPath).
    setStagedCrop({
      png,
      previewUrl: URL.createObjectURL(new Blob([new Uint8Array(png)], { type: 'image/png' })),
    })
    setError('')
  }

  // Stage a primary-scene selection — previewed from its tip; the copy into the
  // app's images folder only runs when Apply commits.
  function selectScene(scenePath: string) {
    setStagedCrop(null)
    setStagedScene(scenePath)
    setError('')
  }

  // Select a past upload — already stored, so just repoint the preview; nothing to
  // upload. Apply persists the reference.
  function selectRecent(fileName: string) {
    setStagedCrop(null)
    setStagedScene(null)
    setUrl(fileName)
    setError('')
  }

  // The ONLY place that persists: commit the staged selection (cropped upload,
  // picked scene, or a recent/URL reference) through the page's persist primitive,
  // then close. The side effect (upload/scene-copy) runs INSIDE the producer, after
  // persistPatch's single-flight + validation guards; a refused/failed persist keeps
  // the dialog open with the staged selection intact and the error shown.
  async function commit() {
    // Nothing changed → just close (don't re-save the same image). The offset
    // counts as a change on its own: re-framing without touching the picture is
    // the whole point of the control, and it must not silently no-op.
    if (!stagedCrop && !stagedScene && url === image && offset === offsetY) {
      onClose()
      return
    }
    const crop = stagedCrop
    const scene = stagedScene
    setBusy(true)
    setError('')
    try {
      const saved = await onApply(
        crop
          ? async () => {
              const served = await uploadCroppedAvatar({ data: { characterId, bytes: crop.png } })
              return { image: served, imageScene: '', imageOffsetY: offset }
            }
          : scene
            ? async () => {
                const served = await setAvatarFromScene({ data: { characterId, scenePath: scene } })
                return { image: served, imageScene: scene, imageOffsetY: offset }
              }
            : async () => ({ image: url, imageScene: '', imageOffsetY: offset }),
      )
      if (saved !== null) onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Delete a past upload from the gallery (never the active one — its ✕ is
  // disabled). Drops it from the list optimistically on success.
  async function deleteRecent(fileName: string) {
    setBusy(true)
    setError('')
    try {
      await deleteCharacterUpload({ data: { characterId, fileName } })
      setRecent((r) => r.filter((f) => f !== fileName))
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
          onApply={(png) => stageCrop(png)}
          onCancel={cancelCrop}
        />
      ) : (
        <>
        {/* Two previews, because they answer two different questions: the square
            is WHICH picture is stored, the portrait is HOW it will be framed.
            Same height, so the row reads as one pair. */}
        <div className="flex items-start justify-center gap-4">
          <div className="flex flex-col items-center gap-1.5">
            {stagedCrop ? (
              // The freshly-cropped bytes, not yet uploaded.
              <Portrait
                src={stagedCrop.previewUrl}
                name={name}
                zoom={false}
                className="size-40 rounded-lg"
                fallbackClassName="text-5xl"
              />
            ) : stagedScene ? (
              // The picked scene's tip, not yet copied in.
              <Portrait
                scenePath={stagedScene}
                name={name}
                zoom={false}
                className="size-40 rounded-lg"
                fallbackClassName="text-5xl"
              />
            ) : (
              <Avatar
                image={url}
                name={name}
                className="size-40 rounded-lg"
                fallbackClassName="text-5xl"
              />
            )}
            <span className="text-xs text-muted-foreground">Stored image</span>
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <HeaderFramePreview src={previewSrc} name={name} offsetY={offset} />
            <span className="text-xs text-muted-foreground">Framed in the app</span>
          </div>
        </div>

        {/* The character's vertical framing offset. Lives here rather than in the
            form because it belongs to the picture, and because this is the only
            place both previews are on screen to tune it against. */}
        <div>
          <div className="flex items-center gap-3">
            <Label htmlFor="avatar-offset-y" className="shrink-0">
              Vertical offset
            </Label>
            <input
              id="avatar-offset-y"
              type="range"
              min={-OFFSET_LIMIT}
              max={OFFSET_LIMIT}
              step={0.5}
              // Clamped for the TRACK only: a value typed past the slider's range
              // is still legal (the schema allows ±50) and must not be silently
              // rewritten by the thumb rendering at the end of its travel.
              value={Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, offset))}
              disabled={busy}
              onChange={(e) => setOffset(Number(e.target.value))}
              className="flex-1"
            />
            <NumberField
              value={offset}
              onCommit={(v) => setOffset(Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, v)))}
              className="w-20 pr-6"
              suffix="%"
              title="Percent of the picture — positive moves it down"
            />
            <Button
              variant="ghost"
              disabled={busy || offset === 0}
              onClick={() => setOffset(0)}
              title="Back to the default framing"
            >
              Reset
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Moves this character&rsquo;s picture up or down in every avatar and scene thumbnail in
            the app &mdash; for a figure Daz frames too high or too low in the previews it renders.
            0 is the default.
          </p>
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
              256–2048px, any shape — you&rsquo;ll crop it to a square
            </span>
          </button>
        </FileDropZone>

        {/* Recent uploads — a rolling history so switching to a scene (or a
            different upload) no longer loses the last one. Only past uploads,
            newest first; the active one (if it's an upload) is ringed. */}
        {recent.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm text-muted-foreground">Recent uploads:</p>
            <div className="flex flex-wrap gap-2">
              {recent.map((fileName) => (
                <div key={fileName} className="relative">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => selectRecent(fileName)}
                    title="Use this uploaded image"
                    className={`block rounded-md ring-2 transition focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50 ${
                      fileName === url && !stagedScene && !stagedCrop
                        ? 'ring-primary'
                        : 'ring-transparent hover:ring-primary'
                    }`}
                  >
                    {/* Same portrait frame as the scene thumbnails below, so the
                        two rows read as one gallery. The stored upload is square;
                        shown object-top (no zoom) it mirrors the header crop. */}
                    <Portrait
                      image={fileName}
                      name={name}
                      zoom={false}
                      imgClassName="object-top"
                      className="aspect-[3/4] w-16 rounded-md"
                      fallbackClassName="text-lg"
                    />
                  </button>
                  {/* Delete ✕ — a sibling (not nested in the select button).
                      Disabled for the active image (deleting the referenced file
                      would break the avatar). Scene thumbnails have no ✕: they
                      re-derive from the scene and aren't stored uploads. */}
                  <button
                    type="button"
                    disabled={busy || fileName === image || fileName === url}
                    onClick={() => void deleteRecent(fileName)}
                    title={
                      fileName === image || fileName === url
                        ? "Can't delete the current image"
                        : 'Delete this upload'
                    }
                    aria-label="Delete this upload"
                    className="absolute -top-1.5 -right-1.5 rounded-full border border-background bg-neutral-900 p-0.5 text-white shadow transition hover:bg-destructive disabled:pointer-events-none disabled:opacity-30"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Offer the PRIMARY scene's thumbnail as an avatar source (only when a
            primary is linked). Non-primary scenes are intentionally not offered. */}
        {scenes.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm text-muted-foreground">Primary Daz scene image:</p>
            <div className="flex flex-wrap gap-2">
              {scenes.map((scene) => (
                <button
                  key={scene}
                  type="button"
                  disabled={busy}
                  onClick={() => selectScene(scene)}
                  title={scene.split(/[\\/]/).pop()}
                  className={`rounded-md ring-2 transition focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50 ${
                    stagedScene === scene ? 'ring-primary' : 'ring-transparent hover:ring-primary'
                  }`}
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
            disabled={busy}
            onChange={(e) => {
              // Typing / pasting a URL supersedes any staged scene or crop.
              setUrl(e.target.value)
              setStagedScene(null)
              setStagedCrop(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commit()
            }}
          />
          {/* The ONLY save action — commits whichever selection is staged. */}
          <Button disabled={busy} onClick={() => void commit()}>
            {busy ? 'Applying…' : 'Apply'}
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
