import { describe, expect, it } from 'vitest'

import { characterFolderName, definitionFileName, normalizeRelPath } from './library'

describe('characterFolderName', () => {
  it('preserves case and spaces', () => {
    expect(characterFolderName('Electra Test')).toBe('Electra Test')
  })

  it('strips path-illegal characters', () => {
    expect(characterFolderName('Hero: A/B*?')).toBe('Hero A B')
  })

  it('collapses whitespace and trims trailing dot/space', () => {
    expect(characterFolderName('  Nyx   the   Cat .  ')).toBe('Nyx the Cat')
  })

  it('falls back to Character when empty', () => {
    expect(characterFolderName('')).toBe('Character')
    expect(characterFolderName('///')).toBe('Character')
  })

  it('escapes reserved Windows device names', () => {
    expect(characterFolderName('CON')).toBe('CON_')
    expect(characterFolderName('lpt1')).toBe('lpt1_')
  })
})

describe('definitionFileName', () => {
  it('appends .json to the folder name', () => {
    expect(definitionFileName('Electra Test')).toBe('Electra Test.json')
  })
})

describe('normalizeRelPath', () => {
  it('normalises separators and trims slashes', () => {
    expect(normalizeRelPath('Clients\\Acme\\Electra\\')).toBe('Clients/Acme/Electra')
    expect(normalizeRelPath('Sub/./Name')).toBe('Sub/Name')
  })

  it('rejects absolute paths and drive letters', () => {
    expect(() => normalizeRelPath('/etc/passwd')).toThrow()
    expect(() => normalizeRelPath('C:\\Windows')).toThrow()
  })

  it('rejects parent-directory traversal', () => {
    expect(() => normalizeRelPath('../escape')).toThrow(/outside/)
    expect(() => normalizeRelPath('a/../../b')).toThrow(/outside/)
  })

  it('rejects illegal characters and empty input', () => {
    expect(() => normalizeRelPath('a/b*c')).toThrow(/Illegal/)
    expect(() => normalizeRelPath('   ')).toThrow(/empty/)
  })
})
