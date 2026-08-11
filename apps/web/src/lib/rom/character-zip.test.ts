import { describe, expect, it } from 'vitest'

import {
  characterZipExclusions,
  characterZipFileName,
  characterZipManifestSchema,
  rekeyAvatarFileName,
  repointExecuteStampsText,
  repointExportFoldersRecordText,
  repointPath,
  repointProductScansText,
  repointRomRunLogText,
} from './character-zip.ts'

const DATE = new Date('2026-08-11T14:30:00Z')

describe('characterZipFileName', () => {
  it('names the zip after the character folder + date with the dedicated suffix', () => {
    expect(characterZipFileName('Kira', DATE)).toBe('Kira_2026-08-11.dcsc.zip')
  })

  it('suffixes the STEM on a retry and sanitizes the name', () => {
    expect(characterZipFileName('Kira', DATE, 2)).toBe('Kira_2026-08-11 (2).dcsc.zip')
    expect(characterZipFileName('K:ra?', DATE)).toBe('K ra_2026-08-11.dcsc.zip')
  })
})

describe('characterZipManifestSchema', () => {
  const manifest = {
    format: 'dcs-character',
    formatVersion: 1,
    characterId: 'char-kira',
    characterName: 'Kira',
    definitionFile: 'Kira.json',
  }

  it('accepts a minimal manifest and fills the defaults', () => {
    const parsed = characterZipManifestSchema.parse(manifest)
    expect(parsed.includes).toEqual({ dazExports: false, houdiniExports: false })
    expect(parsed.sourceFolder).toBe('')
  })

  it('refuses a foreign format and a path-shaped definitionFile', () => {
    expect(() => characterZipManifestSchema.parse({ ...manifest, format: 'other' })).toThrow()
    expect(() =>
      characterZipManifestSchema.parse({ ...manifest, definitionFile: 'sub/Kira.json' }),
    ).toThrow()
  })
})

describe('characterZipExclusions', () => {
  it('always prunes the transient Houdini job transport', () => {
    const { excludeRel } = characterZipExclusions({
      exportSubdir: 'export',
      includeDazExports: true,
      includeHoudiniExports: true,
    })
    expect(excludeRel).toEqual(['.dth_houdini_job.json', '.dth_houdini_result.json'])
  })

  it('prunes the export trees only when their toggle is off', () => {
    const slim = characterZipExclusions({
      exportSubdir: 'export',
      includeDazExports: false,
      includeHoudiniExports: false,
    })
    // daz-export by NAME (the legacy tree's location varies); the final export
    // folder by rel path (its name is too generic to match at any depth).
    expect(slim.excludeDirNames).toEqual(['daz-export', 'dth-exports'])
    expect(slim.excludeRel).toContain('export')
    const full = characterZipExclusions({
      exportSubdir: 'export',
      includeDazExports: true,
      includeHoudiniExports: true,
    })
    expect(full.excludeDirNames).toEqual([])
    expect(full.excludeRel).not.toContain('export')
  })
})

describe('rekeyAvatarFileName', () => {
  it('re-keys the current scheme, its .src sibling, and the legacy prefixes', () => {
    expect(rekeyAvatarFileName('old--sc-123.png', 'old', 'new')).toBe('new--sc-123.png')
    expect(rekeyAvatarFileName('old--up-9.src.png', 'old', 'new')).toBe('new--up-9.src.png')
    expect(rekeyAvatarFileName('old.png', 'old', 'new')).toBe('new.png')
    expect(rekeyAvatarFileName('old-123.png', 'old', 'new')).toBe('new-123.png')
  })

  it('leaves other characters’ files and unknown names alone', () => {
    expect(rekeyAvatarFileName('other--sc-123.png', 'old', 'new')).toBe('other--sc-123.png')
    expect(rekeyAvatarFileName('unrelated.txt', 'old', 'new')).toBe('unrelated.txt')
  })
})

const FROM = 'D:/Old Projects/Demo/Kira'
const TO = 'X:/Projects/Fresh/Kira (2)'

describe('repointPath', () => {
  it('repoints inside-the-folder paths and leaves outside links untouched', () => {
    expect(repointPath(`${FROM}/daz3d/primary/Kira.duf`, FROM, TO)).toBe(
      `${TO}/daz3d/primary/Kira.duf`,
    )
    expect(repointPath('D:/Elsewhere/Scene.duf', FROM, TO)).toBe('D:/Elsewhere/Scene.duf')
  })
})

describe('meta-file repointers', () => {
  it('repoints the export-folder record’s exportDir', () => {
    const text = JSON.stringify({
      version: 1,
      exportDir: `${FROM}/houdini/daz-export`,
      folders: ['primary'],
    })
    const fixed = repointExportFoldersRecordText(text, FROM, TO)
    expect(fixed).not.toBeNull()
    expect(JSON.parse(fixed!)).toEqual({
      version: 1,
      exportDir: `${TO}/houdini/daz-export`,
      folders: ['primary'],
    })
  })

  it('re-keys the execute stamps’ scene keys (normalized, like their writers)', () => {
    const text = JSON.stringify({
      version: 1,
      scenes: {
        'd:/old projects/demo/kira/daz3d/primary/kira.duf': { mtimeMs: 1, size: 2, signature: 's' },
        'd:/elsewhere/scene.duf': { mtimeMs: 3, size: 4, signature: 't' },
      },
    })
    const fixed = repointExecuteStampsText(text, FROM, TO)
    expect(fixed).not.toBeNull()
    expect(Object.keys(JSON.parse(fixed!).scenes)).toEqual([
      'x:/projects/fresh/kira (2)/daz3d/primary/kira.duf',
      'd:/elsewhere/scene.duf',
    ])
  })

  it('repoints the run log’s per-scene paths and the product scans’ scenePath', () => {
    const log = JSON.stringify({
      ok: true,
      runs: [{ scene: `${FROM}/daz3d/primary/Kira.duf` }, { scene: '' }],
    })
    expect(JSON.parse(repointRomRunLogText(log, FROM, TO)!).runs[0].scene).toBe(
      `${TO}/daz3d/primary/Kira.duf`,
    )
    const products = JSON.stringify({
      version: 1,
      scans: [{ scenePath: `${FROM}/daz3d/primary/Kira.duf`, products: [] }],
    })
    expect(JSON.parse(repointProductScansText(products, FROM, TO)!).scans[0].scenePath).toBe(
      `${TO}/daz3d/primary/Kira.duf`,
    )
  })

  it('returns null for unparseable or already-correct files', () => {
    expect(repointExportFoldersRecordText('not json', FROM, TO)).toBeNull()
    expect(
      repointExportFoldersRecordText(
        JSON.stringify({ version: 1, exportDir: 'D:/Elsewhere/x', folders: [] }),
        FROM,
        TO,
      ),
    ).toBeNull()
  })
})
