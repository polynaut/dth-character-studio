export type Drift = {
  file: string
  line: number
  kind: 'palette' | 'arbitrary' | 'hex' | 'raw-control'
  match: string
}

const PALETTE =
  /(?<![\w-])(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|shadow)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)(?:\/\d+)?(?![\w-])/g
// A trailing ":" is an arbitrary variant (data-[state=open]:), not an arbitrary value.
const ARBITRARY = /(?<![\w-])(?:[\w-]+:)*[a-z][\w-]*-\[[^\]\s]+\](?![\w[-]|:)/g
const HEX = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/g
const RAW_CONTROL = /<(?:button|input|select|textarea)(?![\w-])/g

export function scanDrift(files: Record<string, string>): Drift[] {
  const out: Drift[] = []
  for (const [file, src] of Object.entries(files)) {
    src.split('\n').forEach((text, i) => {
      const line = i + 1
      const add = (kind: Drift['kind'], re: RegExp, s: string) => {
        for (const m of s.matchAll(re)) out.push({ file, line, kind, match: m[0] })
      }
      add('arbitrary', ARBITRARY, text)
      // Masked so an arbitrary value's hex is reported once, as arbitrary.
      const rest = text.replace(ARBITRARY, (m) => ' '.repeat(m.length))
      add('palette', PALETTE, rest)
      add('hex', HEX, rest)
      add('raw-control', RAW_CONTROL, rest)
    })
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}
