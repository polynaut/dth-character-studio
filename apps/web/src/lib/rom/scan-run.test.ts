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
  const ROOT = 'C:/Lib/Scripts/DTH-Character-Studio'
  const script = scanRunScript({
    outDir: 'C:/out',
    resultPath: 'C:/out/K.scan.json',
    genesis: 'G9',
    runtimeRoot: ROOT,
  })

  it('resolves the runtime from its own folder FIRST, then the baked root', () => {
    // The script is written into the studio's scripts folder beside the runtime,
    // so its own folder is normally right — and stays first, so an install the
    // user relocated keeps using the runtime sitting next to it.
    //
    // But it may not be TRUSTED: this file runs as a Runner batch row, and the
    // batch may launch Daz itself. On the first row of a batch in a cold-started
    // Daz, getScriptFileName() answers with a Daz-internal path (runtime v84) —
    // the failure that made a two-scene export lose its first scene.
    expect(script).toContain('var dthSelfDir = String(new DzFileInfo(getScriptFileName()).path());')
    expect(script).toContain(`var dthBakedRuntimeDir = "${ROOT}";`)
    expect(script).toContain('if (dthSelfDir != "" && (new DzFile(dthSelfDir + "/.DthUtils.dsa")).exists()) return dthSelfDir;')
    expect(script).toContain('include(dthRuntimeDir + "/.DthUtils.dsa");')
    expect(script).toContain('include(dthRuntimeDir + "/.DthScanFrames.dsa");')
    // The old form resolved purely through the lying API.
    expect(script).not.toContain('include(dir_self.filePath')
  })

  it('keeps both include()s at the TOP level', () => {
    // Daz resolves include() through its legacy-include mechanism, which fails
    // inside try/catch ("URIError: Legacy Include") — which is exactly why the
    // resolver returns a DIRECTORY instead of wrapping the include. Top level =
    // an unindented line; any block would indent it.
    const top = script.split('\n').filter((line) => line.startsWith('include('))
    expect(top).toHaveLength(2)
  })

  it('forward-slashes the baked root and drops a trailing separator', () => {
    // The host hands over a join()ed Windows path; DzFile wants '/', and the
    // probe concatenates `+ "/.DthUtils.dsa"` rather than joining.
    const win = scanRunScript({
      outDir: 'C:/out',
      resultPath: 'C:/out/K.scan.json',
      genesis: 'G9',
      runtimeRoot: 'C:\\Lib\\Scripts\\DTH-Character-Studio\\',
    })
    expect(win).toContain('var dthBakedRuntimeDir = "C:/Lib/Scripts/DTH-Character-Studio";')
  })

  it('bakes an EMPTY root when none is given, switching the fallback off', () => {
    const bare = scanRunScript({ outDir: 'C:/out', resultPath: 'C:/out/K.scan.json', genesis: 'G9' })
    expect(bare).toContain('var dthBakedRuntimeDir = "";')
    expect(bare).toContain('if (dthBakedRuntimeDir != "" &&')
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
