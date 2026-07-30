import { describe, expect, it } from 'vitest'

import {
  houdiniVersionFromDocs,
  houdiniVersionFromInstall,
  matchingHoudiniDocsFolder,
} from './houdini-version'

describe('houdini install ↔ documents pairing', () => {
  it('extracts major.minor from an install folder', () => {
    expect(houdiniVersionFromInstall('C:\\Program Files\\Side Effects Software\\Houdini 22.0.368')).toBe('22.0')
    expect(houdiniVersionFromInstall('D:/apps/Houdini 21.5.123/')).toBe('21.5')
    expect(houdiniVersionFromInstall('C:/no/version/here')).toBe('')
    expect(houdiniVersionFromInstall('')).toBe('')
  })

  it('extracts major.minor from a docs folder (houdiniX.Y basenames only)', () => {
    expect(houdiniVersionFromDocs('D:\\User Data\\Documents\\houdini22.0')).toBe('22.0')
    expect(houdiniVersionFromDocs('D:/Documents/Houdini21.5/')).toBe('21.5')
    expect(houdiniVersionFromDocs('D:/Documents/houdini')).toBe('')
    expect(houdiniVersionFromDocs('D:/Documents/somethingelse22.0')).toBe('')
  })

  it('pairs an install with the matching configured docs folder', () => {
    const docs = ['D:\\Docs\\houdini21.0', 'D:\\Docs\\houdini22.0']
    expect(
      matchingHoudiniDocsFolder('C:\\Program Files\\Side Effects Software\\Houdini 22.0.368', docs),
    ).toBe('D:\\Docs\\houdini22.0')
    // No match → null (caller warns / refuses); unparseable install too.
    expect(matchingHoudiniDocsFolder('C:\\SideFX\\Houdini 20.5.100', docs)).toBeNull()
    expect(matchingHoudiniDocsFolder('C:\\no\\version', docs)).toBeNull()
    expect(matchingHoudiniDocsFolder('C:\\SideFX\\Houdini 22.0.1', [])).toBeNull()
  })
})
