import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrast, parseTokens } from './tokens'

const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
const t = parseTokens(css)

describe('status tokens', () => {
  it.each(['warning', 'success', 'info'])('%s text reaches AA on every surface', (tone) => {
    for (const bg of [t.background, t.card, t[`${tone}-subtle`]])
      expect(contrast(t[tone], bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('error text reaches AA on every surface', () => {
    for (const bg of [t.background, t.card, t['destructive-subtle']])
      expect(contrast(t['destructive-text'], bg)).toBeGreaterThanOrEqual(4.5)
  })
  it('keeps destructive and primary unchanged', () => {
    expect(t.destructive).toBe('#e5605e')
    expect(t.primary).toBe('#fe5c01')
  })
})
