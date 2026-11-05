export type Drift = {
  file: string
  line: number
  kind: 'palette' | 'arbitrary' | 'hex' | 'raw-control'
  match: string
}

const PALETTE =
  /(?<![\w-])(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|shadow)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)(?:\/\d+)?(?![\w-])/g
// A trailing ":" is an arbitrary variant (data-[state=open]:), not an arbitrary value.
const ARBITRARY = /(?<![\w-])(?:[\w-]+:)*([a-z][\w-]*)-\[([^\]\s]+)\](?![\w[-]|:)/g
// Only colour-bearing utilities can be covered by a colour token; w-[..], z-[..], aspect-[..] cannot.
const COLOR_ONLY = new Set(['bg', 'fill', 'from', 'to', 'via', 'accent', 'caret'])
// These double as sizes and widths (text-[10px], border-[3px]), so they count only when the value is a colour.
const COLOR_OR_SIZE = new Set(['text', 'border', 'ring', 'stroke', 'outline', 'shadow', 'divide', 'decoration'])
const COLOR_VALUE = /#[0-9a-f]{3,8}|rgb|hsl|oklch|oklab|color-mix|^color:|var\(--color/i
const NOT_COLOR = /^(url\(|length:|position:|size:|-?[\d.]+(px|rem|em|%|vw|vh)?$)/

const isColorDrift = (prefix: string, value: string) =>
  (COLOR_ONLY.has(prefix) && !NOT_COLOR.test(value)) || (COLOR_OR_SIZE.has(prefix) && COLOR_VALUE.test(value))
const HEX = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/g
const RAW_CONTROL = /<(?:button|input|select|textarea)(?![\w-])/g

// ROM timeline colours are data colours (one per section), not UI chrome.
const EXEMPT = 'apps/web/src/components/rom/rom-timeline.tsx'

export function scanDrift(files: Record<string, string>): Drift[] {
  const out: Drift[] = []
  for (const [file, src] of Object.entries(files)) {
    if (file === EXEMPT) continue
    src.split('\n').forEach((text, i) => {
      const line = i + 1
      const add = (kind: Drift['kind'], re: RegExp, s: string) => {
        for (const m of s.matchAll(re)) out.push({ file, line, kind, match: m[0] })
      }
      for (const m of text.matchAll(ARBITRARY))
        if (isColorDrift(m[1], m[2])) out.push({ file, line, kind: 'arbitrary', match: m[0] })
      // Masked so an arbitrary value's hex is reported once, as arbitrary.
      const rest = text.replace(ARBITRARY, (m) => ' '.repeat(m.length))
      add('palette', PALETTE, rest)
      add('hex', HEX, rest)
      add('raw-control', RAW_CONTROL, rest)
    })
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}
