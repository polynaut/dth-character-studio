// Minimal typings for gifenc (ships without them; CJS — default-import it).
declare module 'gifenc' {
  interface Gif {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts: { palette: number[][]; delay?: number },
    ): void
    finish(): void
    bytes(): Uint8Array
  }
  const gifenc: {
    GIFEncoder(): Gif
    quantize(rgba: Uint8Array, maxColors: number): number[][]
    applyPalette(rgba: Uint8Array, palette: number[][]): Uint8Array
  }
  export default gifenc
}
