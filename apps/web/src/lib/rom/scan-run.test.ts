import { describe, expect, it } from 'vitest'

import {
  parseScanResult,
  scanCsvName,
  scanCsvPath,
  scanResultPath,
  scanRunScript,
} from './scan-run.ts'

// The TS half of a contract with `runtime/DthScanFrames.dsa`, which no test can
// run. These cases are the statement of the rule on this side; the `.dsa`
// carries the same one in Daz Script.

const OUT = 'C:/Users/dev/AppData/Local/dth/scan-frames'

describe('scanCsvName — predicting what the scan will write', () => {
  it('is the scene file name without its extension', () => {
    // The script derives it from the OPEN scene, so the studio can name the
    // file it waits for before Daz has even started.
    expect(scanCsvName('D:/scenes/Kira_G9.duf')).toBe('Kira_G9')
    expect(scanCsvName('D:\\scenes\\Kira_G9.duf')).toBe('Kira_G9')
  })

  it('drops only the LAST extension, like completeBaseName()', () => {
    expect(scanCsvName('D:/scenes/Kira.G9.duf')).toBe('Kira.G9')
  })

  it('replaces exactly the characters the .dsa replaces', () => {
    // Windows-forbidden characters → '_'. A scene name cannot legally hold most
    // of these, but the rule has to match the script character for character or
    // the studio waits for a file that will never appear under that name.
    expect(scanCsvName('D:/scenes/Ki*ra?"<>|.duf')).toBe('Ki_ra_____')
  })

  it('places the CSV and the result side by side in the scan folder', () => {
    expect(scanCsvPath(OUT, 'D:/scenes/Kira_G9.duf')).toBe(`${OUT}/Kira_G9.csv`)
    // A sibling, not one shared file: two scans must not overwrite each other's
    // verdict, and a stale result can never be read as this run's.
    expect(scanResultPath(OUT, 'D:/scenes/Kira_G9.duf')).toBe(`${OUT}/Kira_G9.scan.json`)
  })

  it('tolerates a trailing separator on the out dir', () => {
    expect(scanCsvPath(`${OUT}/`, 'D:/s/K.duf')).toBe(`${OUT}/K.csv`)
  })
})

describe('parseScanResult', () => {
  it('reads a finished result', () => {
    const result = parseScanResult('{"ok":true,"error":"","csvPath":"C:/a/K.csv","frames":51}')
    expect(result).toEqual({ ok: true, error: '', csvPath: 'C:/a/K.csv', frames: 51 })
  })

  it('reads a failure with its reason', () => {
    expect(parseScanResult('{"ok":false,"error":"No keyed morph frames"}')?.error).toBe(
      'No keyed morph frames',
    )
  })

  it('is NULL for a torn read — the poll asks again, it does not report a failure', () => {
    // The studio polls while Daz may still be writing the file. A half-written
    // result read as `ok:false` would abort a scan that is about to succeed.
    expect(parseScanResult('{"ok":tr')).toBeNull()
    expect(parseScanResult('')).toBeNull()
    expect(parseScanResult('{"ok":"yes"}')).toBeNull()
  })
})

describe('scanRunScript', () => {
  const script = scanRunScript({
    outDir: 'C:/out',
    resultPath: 'C:/out/K.scan.json',
    genesis: 'G9',
  })

  it('resolves the runtime from its OWN folder, like the shelf script', () => {
    // Load-bearing: the script is written into the studio's scripts folder in
    // the Daz library, and this is how it finds the runtime installed beside it.
    expect(script).toContain('getScriptFileName()')
    expect(script).toContain('include(dir_self.filePath(".DthUtils.dsa"));')
    expect(script).toContain('include(dir_self.filePath(".DthScanFrames.dsa"));')
  })

  it('runs SILENT — no dialog can block a runner nobody is watching', () => {
    expect(script).toContain('silent: true')
  })

  it('passes the generation, which is how the run selects the figure', () => {
    expect(script).toContain('genesis: "G9"')
  })

  it('escapes Windows paths into legal Daz Script strings', () => {
    const win = scanRunScript({
      outDir: 'C:\\Users\\dev\\out',
      resultPath: 'C:\\Users\\dev\\out\\K.scan.json',
      genesis: 'G9',
    })
    expect(win).toContain('outDir: "C:\\\\Users\\\\dev\\\\out"')
  })

  it('starts with the Daz Script header, or Daz will not run it', () => {
    expect(script.startsWith('// DAZ Studio version 4.0.0+ filetype DAZ Script')).toBe(true)
  })
})
