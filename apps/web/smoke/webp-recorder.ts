// Deterministic animated-WebP recording for the guide: interactions rendered as
// a fixed sequence of screenshot FRAMES (not a video capture), with a fake cursor
// overlay standing in for the OS pointer headless Chromium never draws. App
// transitions are pinned to 0ms while recording; the cursor gliding between UI
// states provides the motion instead.
//
// The same frames encode to the same WebP on a given machine (sharp/libwebp is
// deterministic for a pinned version + options), so the screenshot pipeline's
// contract — regenerating leaves `git diff` empty — holds for these clips too.
// WebP replaces the old 256-colour GIF: crisp UI text (lossless) at a fraction
// of the size.

import { writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import sharp from 'sharp'

import type { Page } from '@playwright/test'

export interface WebpClip {
  x: number
  y: number
  width: number
  height: number
}

/** Ease the cursor like a hand would — slow in, fast middle, slow out. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class WebpRecorder {
  private frames: Array<{ data: Buffer; delay: number }> = []
  private size: { width: number; height: number } | null = null
  private cursor = { x: 0, y: 0 }

  constructor(
    private page: Page,
    private clip?: WebpClip,
  ) {}

  /**
   * Install the fake cursor + freeze every CSS transition/animation (frames
   * must capture settled states, never mid-flight ones). Call once per page,
   * after the route has rendered; position it before the first frame.
   */
  async install() {
    await this.page.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = `
        *, *::before, *::after {
          transition-duration: 0ms !important;
          animation-duration: 0ms !important;
          caret-color: transparent !important;
        }`
      document.head.appendChild(style)
      const cursor = document.createElement('div')
      cursor.id = 'gif-cursor'
      cursor.style.cssText =
        'position:fixed;left:0;top:0;z-index:999999;pointer-events:none;filter:drop-shadow(0 1px 2px rgb(0 0 0/.6))'
      cursor.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 20 20"><path d="M2 1 L2 15.5 L6.3 12.2 L8.8 17.6 L11.3 16.5 L8.9 11.2 L14.2 11 Z" fill="#f2efe9" stroke="#1a1a1a" stroke-width="1.3"/></svg>'
      document.body.appendChild(cursor)
    })
  }

  private async place(x: number, y: number) {
    this.cursor = { x, y }
    await this.page.mouse.move(x, y) // real hover states…
    await this.page.evaluate(([cx, cy]) => {
      const el = document.getElementById('gif-cursor')
      if (el) el.style.transform = `translate(${cx}px, ${cy}px)` // …and the visible pointer
    }, [x, y] as const)
  }

  /** Jump the cursor somewhere without recording (the starting position). */
  async placeAt(x: number, y: number) {
    await this.place(x, y)
  }

  /** Capture the current state as one frame. */
  async frame(delay = 90) {
    const shot = await this.page.screenshot(this.clip ? { clip: this.clip } : {})
    const png = PNG.sync.read(shot)
    if (!this.size) this.size = { width: png.width, height: png.height }
    this.frames.push({ data: Buffer.from(png.data), delay })
  }

  /** Hold the current state for a while (one long-delay frame). */
  async hold(ms: number) {
    await this.frame(ms)
  }

  /** Glide the cursor to a target across `steps` recorded frames (eased). */
  async glideTo(x: number, y: number, steps = 10) {
    const from = { ...this.cursor }
    for (let i = 1; i <= steps; i++) {
      const t = easeInOut(i / steps)
      await this.place(from.x + (x - from.x) * t, from.y + (y - from.y) * t)
      await this.page.waitForTimeout(30) // let hover states apply (transitions are 0ms)
      await this.frame(50)
    }
  }

  /** Click at the current cursor position, with a visible press pulse. */
  async click() {
    await this.page.evaluate(([cx, cy]) => {
      const pulse = document.createElement('div')
      pulse.id = 'gif-click-pulse'
      pulse.style.cssText =
        `position:fixed;left:${cx - 11}px;top:${cy - 11}px;width:22px;height:22px;` +
        'border:2.5px solid #fe5c01;border-radius:999px;z-index:999998;pointer-events:none'
      document.body.appendChild(pulse)
    }, [this.cursor.x, this.cursor.y] as const)
    await this.page.mouse.down()
    await this.frame(110)
    await this.page.mouse.up()
    await this.page.evaluate(() => document.getElementById('gif-click-pulse')?.remove())
    await this.page.waitForTimeout(60)
    await this.frame(90)
  }

  /** Encode all frames and write the animated WebP. */
  async save(path: string) {
    if (!this.size) throw new Error('no frames recorded')
    const { width, height } = this.size
    // sharp joins an array of images into one animation; it needs decodable
    // inputs (raw pixel buffers aren't accepted by `join`), so encode each frame
    // to PNG first, then join to a lossless animated WebP with per-frame delays.
    const pngs = await Promise.all(
      this.frames.map((frame) =>
        sharp(frame.data, { raw: { width, height, channels: 4 } }).png().toBuffer(),
      ),
    )
    const webp = await sharp(pngs, { join: { animated: true } })
      .webp({
        delay: this.frames.map((frame) => frame.delay),
        loop: 0,
        lossless: true,
        effort: 6,
      })
      .toBuffer()
    writeFileSync(path, webp)
  }
}
