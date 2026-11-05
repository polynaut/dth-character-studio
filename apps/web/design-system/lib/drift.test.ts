import { describe, expect, it } from 'vitest'
import { scanDrift } from './drift'

const hits = (src: string) => scanDrift({ 'a.tsx': src }).map((h) => h.kind)

describe('scanDrift', () => {
  it('flags each kind', () => {
    expect(hits('className="text-amber-500"')).toEqual(['palette'])
    expect(hits('className="bg-[#333]"')).toEqual(['arbitrary'])
    expect(hits('const c = "#fe5c01"')).toEqual(['hex'])
    expect(hits('<button onClick={f}>')).toEqual(['raw-control'])
    expect(hits('<button')).toEqual(['raw-control'])
  })
  it('ignores tokens and the kit Button', () => {
    expect(hits('className="text-warning bg-card"')).toEqual([])
    expect(hits('<Button variant="outline">')).toEqual([])
  })
  it('reports the line and the match', () => {
    expect(scanDrift({ 'a.tsx': 'x\ny text-red-500' })[0]).toMatchObject({
      line: 2,
      match: 'text-red-500',
    })
  })
  it('counts every hit on a line', () => {
    expect(hits('border-red-500 bg-slate-800/60')).toEqual(['palette', 'palette'])
  })
})
