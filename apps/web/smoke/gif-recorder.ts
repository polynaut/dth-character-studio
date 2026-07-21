// Deterministic GIF recording for the guide: interactions rendered as a fixed
// sequence of screenshot FRAMES (not a video capture), with a fake cursor
// overlay standing in for the OS pointer headless Chromium never draws.
// Identical frames encode to byte-identical GIFs (gifenc is pure JS), so the
// screenshot pipeline's contract — a second run leaves `git diff` empty —
// holds for GIFs too. App transitions are pinned to 0ms while recording; the
// cursor gliding between UI states provides the motion instead.

import { writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { GIFEncoder, quantize, applyPalette } from 'gifenc'

import type { Page } from '@playwright/test'

export interface GifClip {
  x: number
  y: number
  width: number
  height: number
}

/** Ease the cursor like a hand would — slow in, fast middle, slow out. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class GifRecorder {
  private frames: Array<{ data: Uint8Array; delay: number }> = []
  private size: { width: number; height: number } | null = null
  private cursor = { x: 0, y: 0 }

  constructor(
    private page: Page,
    private clip?: GifClip,
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
    this.frames.push({ data: new Uint8Array(png.data), delay })
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

  /** Encode all frames and write the GIF. */
  save(path: string) {
    if (!this.size) throw new Error('no frames recorded')
    const gif = GIFEncoder()
    for (const frame of this.frames) {
      const palette = quantize(frame.data, 256)
      const index = applyPalette(frame.data, palette)
      gif.writeFrame(index, this.size.width, this.size.height, { palette, delay: frame.delay })
    }
    gif.finish()
    writeFileSync(path, gif.bytes())
  }
}
