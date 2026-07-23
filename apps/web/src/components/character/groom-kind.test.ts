import { describe, expect, it } from 'vitest'

import { groomKind } from './groom-kind.tsx'

describe('groomKind', () => {
  it('classifies hair-ish labels as hair', () => {
    expect(groomKind('CHT Sevenly Hair')).toBe('hair')
    expect(groomKind('Nova Ponytail Hair')).toBe('hair')
    expect(groomKind('dForce Black Tie Cap')).toBe('hair')
    expect(groomKind('Full Beard')).toBe('hair')
    expect(groomKind('Thick Eyebrows')).toBe('hair')
  })

  it('classifies geografts as graft (over hair/clothing)', () => {
    expect(groomKind('Golden Palace 9')).toBe('graft')
    expect(groomKind('Dicktator 9')).toBe('graft')
    expect(groomKind('Some Geograft')).toBe('graft')
    expect(groomKind('New Genitalia')).toBe('graft')
  })

  it('defaults anything else to clothing', () => {
    expect(groomKind('dForce Winter Coat')).toBe('clothing')
    expect(groomKind('Combat Boots')).toBe('clothing')
    expect(groomKind('Summertide Bikini')).toBe('clothing')
  })
})
