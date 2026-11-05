import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrast, parseMotion, parseTokens } from './tokens'

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

describe('motion', () => {
  it('duration tokens match the values the app already used', () => {
    expect(t['duration-fast']).toBe('160ms')
    expect(t['duration-base']).toBe('300ms')
    expect(t['duration-slow']).toBe('500ms')
  })
  it('reads each animation and its timing from the stylesheet', () => {
    const motion = parseMotion(css)
    expect(motion).toContainEqual({ name: 'dth-task-retire', timing: '420ms ease-in both' })
    expect(motion).toContainEqual({ name: 'dth-refresh-pulse', timing: '1.8s ease-in-out infinite' })
    expect(motion).toContainEqual({ name: 'dth-busy-bar-stripes', timing: '0.7s linear infinite' })
  })
  it('reports a scroll-driven animation as having no timing', () => {
    expect(parseMotion(css)).toContainEqual({ name: 'dth-avatar-shrink', timing: null })
    expect(parseMotion(css)).toContainEqual({ name: 'dth-avatar-pan', timing: null })
  })
})
