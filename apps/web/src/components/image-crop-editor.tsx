import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@dth/ui'
import {
  avatarOutputSize,
  clampCrop,
  cropSizeForZoomFraction,
  initialCrop,
  MIN_AVATAR_SOURCE_PX,
  panCrop,
  portraitBarFraction,
  zoomCrop,
  zoomFraction,
} from '#/lib/image-crop.ts'

import type { CropRect } from '#/lib/image-crop.ts'

/** The editor viewport's CSS/canvas size (square). Rendering at 2× the largest
 *  stored size keeps the preview crisp on high-DPI displays. */
const VIEW_SIZE = 288

/**
 * Tiny 1:1 crop editor: a square canvas viewport over the source image — drag
 * to pan, wheel or the slider to zoom. All state is a single square rect in
 * SOURCE pixels (see lib/image-crop.ts); the canvas just draws that rect, and
 * Apply re-draws it at the stored resolution (512² when the cropped region is
 * that large, else 256²) and hands back PNG bytes. Pure presentational — the
 * caller owns validation, upload, and persistence.
 */
export function ImageCropEditor({
  bitmap,
  busy,
  onApply,
  onCancel,
}: {
  /** The decoded source image (already validated 256..1024 on both sides). */
  bitmap: ImageBitmap
  busy?: boolean
  /** Receives the cropped avatar as PNG bytes plus its square output size. */
  onApply: (png: Uint8Array, outputSize: number) => void
  onCancel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [crop, setCrop] = useState<CropRect>(() =>
    clampCrop(initialCrop(bitmap.width, bitmap.height), bitmap.width, bitmap.height),
  )
  // Pointer pan: track the last position while a pointer is captured.
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null)

  // Redraw whenever the crop changes: the canvas shows exactly the crop rect.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(
      bitmap,
      crop.x,
      crop.y,
      crop.size,
      crop.size,
      0,
      0,
      canvas.width,
      canvas.height,
    )
  }, [bitmap, crop])

  const zoomable = Math.min(bitmap.width, bitmap.height) > MIN_AVATAR_SOURCE_PX
  const output = avatarOutputSize(crop.size)

  const applyCrop = useCallback(() => {
    // Draw the crop rect at the stored resolution and hand back PNG bytes —
    // side-effect free, so the caller can run it before its persist step.
    const out = document.createElement('canvas')
    out.width = output
    out.height = output
    const ctx = out.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, output, output)
    out.toBlob((blob) => {
      if (!blob) return
      void blob.arrayBuffer().then((buf) => onApply(new Uint8Array(buf), output))
    }, 'image/png')
  }, [bitmap, crop, output, onApply])

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: VIEW_SIZE, height: VIEW_SIZE }}>
        <canvas
          ref={canvasRef}
          width={VIEW_SIZE * 2}
          height={VIEW_SIZE * 2}
          style={{ width: VIEW_SIZE, height: VIEW_SIZE }}
          className="cursor-grab touch-none rounded-lg border border-input active:cursor-grabbing"
          role="img"
          aria-label="Crop preview — drag to reposition, scroll to zoom"
          onPointerDown={(e) => {
            dragRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => {
            const drag = dragRef.current
            if (!drag || drag.pointerId !== e.pointerId) return
            const dx = e.clientX - drag.lastX
            const dy = e.clientY - drag.lastY
            drag.lastX = e.clientX
            drag.lastY = e.clientY
            setCrop((c) => panCrop(c, dx, dy, VIEW_SIZE, bitmap.width, bitmap.height))
          }}
          onPointerUp={(e) => {
            if (dragRef.current?.pointerId === e.pointerId) dragRef.current = null
          }}
          onWheel={(e) => {
            // Wheel up zooms in. The factor per notch is gentle — the slider
            // covers the full range for coarse moves.
            const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08
            setCrop((c) => zoomCrop(c, factor, bitmap.width, bitmap.height))
          }}
        />
        {/* Portrait letterbox guide: the whole square IS the stored 1:1 output,
            but the narrowest place it's shown (the character header) crops to a
            portrait strip. Darken the two side bars 50% so the subject can be
            kept inside the strip that survives portrait display. pointer-events
            off so drag/zoom on the canvas beneath is unaffected. */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-black/50"
          style={{ width: `${portraitBarFraction() * 100}%` }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 rounded-r-lg bg-black/50"
          style={{ width: `${portraitBarFraction() * 100}%` }}
          aria-hidden
        />
      </div>
      <p className="text-xs text-muted-foreground">
        The full square is saved; the darkened sides are cropped in portrait views.
      </p>
      {zoomable && (
        <label className="flex w-full items-center gap-2 text-sm text-muted-foreground">
          Zoom
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(zoomFraction(crop.size, bitmap.width, bitmap.height) * 1000)}
            onChange={(e) => {
              const size = cropSizeForZoomFraction(
                Number(e.target.value) / 1000,
                bitmap.width,
                bitmap.height,
              )
              // Zoom about the crop center, exactly like the wheel path.
              setCrop((c) => zoomCrop(c, c.size / size, bitmap.width, bitmap.height))
            }}
            className="flex-1"
            aria-label="Zoom"
          />
        </label>
      )}
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Saved as {output}×{output}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={applyCrop} disabled={busy}>
            {busy ? 'Saving…' : 'Use this crop'}
          </Button>
        </div>
      </div>
    </div>
  )
}
