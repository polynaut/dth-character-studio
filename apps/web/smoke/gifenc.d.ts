// Minimal typings for gifenc (ships without them). Named exports (the package's
// documented surface) — plain function types with no `this`, so importing and
// calling them trips neither `unbound-method` nor `no-named-as-default-member`.
declare module 'gifenc' {
  interface Gif {
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      opts: { palette: number[][]; delay?: number },
    ) => void
    finish: () => void
    bytes: () => Uint8Array
  }
  export const GIFEncoder: () => Gif
  export const quantize: (rgba: Uint8Array, maxColors: number) => number[][]
  export const applyPalette: (rgba: Uint8Array, palette: number[][]) => Uint8Array
}
