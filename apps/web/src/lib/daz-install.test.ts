import { describe, expect, it } from 'vitest'

import {
  defaultDazApp,
  deriveDazPaths,
  exportOnlyCandidateKeys,
  parseDimAccountIni,
  parseDimCurrentUser,
  parseDzInstallIni,
} from './daz-install.ts'

import type { DazAppFound, DazInstallScan } from './daz-install.ts'

// The fixtures below are the REAL files off a machine with DIM 1.4.1.96 and
// both DAZ Studio 4 and 6 installed (trimmed, and with the credential blob
// replaced by an obvious fake). Hand-written INI would only prove the parser
// handles INI the way the author imagined it.

const DZ_INSTALL_INI = `[General]
InstalledApplications=dzStudio6InstallDir-64 dzStudio4InstallDir-64

[ApplicationPath]
dzStudio6InstallDir-64=C:/Program Files/DAZ 3D/DAZStudio6
dzStudio4InstallDir-64=C:/Program Files/DAZ 3D/DAZStudio4
`

const ACCOUNT_INI = `[General]
AccountTitle=Account
Account=DEADBEEFCAFE0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123
RememberPassword=true
DownloadPath=D:/DAZ 3D/Install Manager/Downloads
MaxConnections=4
CurInstallPath=D:/DAZ 3D/My DAZ 3D Library
Software64Path=C:/Program Files
Software32Path=C:/Program Files (x86)
OverrideManifestDir=D:/DAZ 3D/Install Manager/ManifestFiles
OverrideThumbnailDir=D:/DAZ 3D/Install Manager/Thumbnails
OverrideThumbnailMaxHeight=182

[InstallPaths]
size=1
1\\InstallPathTitle=My DAZ 3D Library
1\\InstallPath=D:/DAZ 3D/My DAZ 3D Library

[ApplicationTags]
size=37
1\\TagID=3dsMax
1\\TagValue=true
`

describe('parseDzInstallIni', () => {
  it('reads the installed Daz apps and puts the newest first', () => {
    // The DS4+DS6 machine: DS6 leads, so activating "the default" activates 6.
    expect(parseDzInstallIni(DZ_INSTALL_INI)).toEqual([
      {
        key: 'dzstudio6installdir-64',
        name: 'DAZ Studio 6',
        version: 6,
        bits: 64,
        path: 'C:/Program Files/DAZ 3D/DAZStudio6',
      },
      {
        key: 'dzstudio4installdir-64',
        name: 'DAZ Studio 4',
        version: 4,
        bits: 64,
        path: 'C:/Program Files/DAZ 3D/DAZStudio4',
      },
    ])
  })

  it('skips a path entry DIM no longer lists as installed', () => {
    // DIM leaves the [ApplicationPath] entry behind after an uninstall.
    // Offering it would activate a folder that is gone.
    const stale = DZ_INSTALL_INI.replace(
      'InstalledApplications=dzStudio6InstallDir-64 dzStudio4InstallDir-64',
      'InstalledApplications=dzStudio6InstallDir-64',
    )
    expect(parseDzInstallIni(stale).map((a) => a.version)).toEqual([6])
  })

  it('falls back to every path entry when nothing is listed', () => {
    const noList = DZ_INSTALL_INI.replace(/InstalledApplications=.*\n/, '')
    expect(parseDzInstallIni(noList).map((a) => a.version)).toEqual([6, 4])
  })

  it('ignores keys that are not a Daz Studio install, and empty paths', () => {
    const odd = `[General]
InstalledApplications=dzStudio6InstallDir-64 dzBryce7InstallDir-32 dzStudio4InstallDir-64

[ApplicationPath]
dzStudio6InstallDir-64=C:/Program Files/DAZ 3D/DAZStudio6
dzBryce7InstallDir-32=C:/Program Files (x86)/DAZ 3D/Bryce7
dzStudio4InstallDir-64=
`
    expect(parseDzInstallIni(odd).map((a) => a.name)).toEqual(['DAZ Studio 6'])
  })

  it('survives a file that is empty or not INI at all', () => {
    expect(parseDzInstallIni('')).toEqual([])
    expect(parseDzInstallIni('<html>404</html>')).toEqual([])
  })
})

const app = (version: number, exists: boolean, bits = 64): DazAppFound => ({
  key: `dzstudio${version}installdir-${bits}`,
  name: `DAZ Studio ${version}`,
  version,
  bits,
  path: `C:/Program Files/DAZ 3D/DAZStudio${version}`,
  exists,
})

describe('defaultDazApp', () => {
  it('prefers the newest Studio — DS6 on a DS4+DS6 machine', () => {
    expect(defaultDazApp([app(6, true), app(4, true)])?.version).toBe(6)
  })

  it('skips an install DIM still lists but whose folder is gone', () => {
    // Activating it would derive an install folder that resolves to nothing.
    expect(defaultDazApp([app(6, false), app(4, true)])?.version).toBe(4)
  })

  it('takes a 32-bit install only when there is no 64-bit one', () => {
    expect(defaultDazApp([app(4, true, 32)])?.bits).toBe(32)
  })

  it('offers nothing when every listed install is missing', () => {
    expect(defaultDazApp([app(6, false), app(4, false)])).toBeNull()
    expect(defaultDazApp([])).toBeNull()
  })
})

describe('exportOnlyCandidateKeys', () => {
  const KEY4 = 'dzstudio4installdir-64'
  const KEY6 = 'dzstudio6installdir-64'
  const KEY7 = 'dzstudio7installdir-64'

  it('offers DS4 beside an active DS6 — scripted export landed in the DS4 exporter', () => {
    // This used to return [] behind a `major >= 5` floor: the Studio 4 exporter
    // had no `doExport`, so a batch there ran every scene and exported nothing.
    // mrpdean shipped scripted export in the DS4 plugin (Exporter 2.0.2.0) and a
    // DS4 batch was measured writing its .abc/.dth on 2026-08-10, so the
    // capability is no longer a generation split (`.ai/gotchas.md`).
    expect(exportOnlyCandidateKeys([app(6, true), app(4, true)], KEY6)).toEqual([KEY4])
  })

  it('offers the older install on the 7 + 6 case too', () => {
    // The shape the feature was written for: authoring has moved to a Studio
    // newer than 6, the Runner has no build for it yet, so the batch keeps
    // running in 6.
    expect(exportOnlyCandidateKeys([app(7, true), app(6, true)], KEY7)).toEqual([KEY6])
  })

  it('never offers it on the ACTIVE install — that is just "the default"', () => {
    expect(exportOnlyCandidateKeys([app(7, true), app(6, true)], KEY7)).not.toContain(KEY7)
  })

  it('offers nothing when an OLDER install is the active one', () => {
    // Going back to Studio 6 for everything is a decision already made with
    // Activate; a switch on the 7 card saying "…but exports here" would be a
    // second, opposite knob for the same question.
    expect(exportOnlyCandidateKeys([app(7, true), app(6, true)], KEY6)).toEqual([])
  })

  it('offers nothing on a single-install machine', () => {
    expect(exportOnlyCandidateKeys([app(6, true)], KEY6)).toEqual([])
  })

  it('skips an older install whose folder is gone — exports would launch nothing', () => {
    expect(exportOnlyCandidateKeys([app(7, true), app(6, false)], KEY7)).toEqual([])
  })

  it('offers nothing when the active install is not the newest LISTED, even if that one is gone', () => {
    // A machine whose DS8 folder was deleted but is still listed has not
    // settled on 7; the studio cannot see the whole layout, so it does not
    // hand out an arrangement that assumes it can.
    expect(exportOnlyCandidateKeys([app(8, false), app(7, true), app(6, true)], KEY7)).toEqual([])
  })

  it('offers every older install on a future 8 + 7 + 6 + 4 machine', () => {
    // Exclusivity is not this function's job — it reports what may be offered,
    // and the single stored key is what allows only one of them to be on.
    expect(
      exportOnlyCandidateKeys(
        [app(8, true), app(7, true), app(6, true), app(4, true)],
        'dzstudio8installdir-64',
      ),
    ).toEqual([KEY7, KEY6, KEY4])
  })

  it('offers nothing when the active key matches no listed install', () => {
    expect(exportOnlyCandidateKeys([app(7, true), app(6, true)], 'gone')).toEqual([])
  })
})

describe('deriveDazPaths', () => {
  const scan: DazInstallScan = {
    dimFound: true,
    apps: [app(6, true), app(4, true)],
    paths: { ...parseDimAccountIni(ACCOUNT_INI) },
    manifests: 'D:/DAZ 3D/Install Manager/ManifestFiles',
    account: 'Account',
  }

  it('derives exactly the three paths an installation decides', () => {
    expect(deriveDazPaths(scan, 'dzstudio6installdir-64')).toEqual({
      dazInstallFolder: 'C:/Program Files/DAZ 3D/DAZStudio6',
      dazLibraryFolder: 'D:/DAZ 3D/My DAZ 3D Library',
      dimManifestsFolder: 'D:/DAZ 3D/Install Manager/ManifestFiles',
    })
  })

  it('follows the activated card, not the newest install', () => {
    expect(deriveDazPaths(scan, 'dzstudio4installdir-64')?.dazInstallFolder).toBe(
      'C:/Program Files/DAZ 3D/DAZStudio4',
    )
  })

  it('derives nothing for a key this machine no longer has', () => {
    // The stored installation is gone (reinstall, new machine). Falling back to
    // "the first app" would silently activate something the user never chose.
    expect(deriveDazPaths(scan, 'dzstudio5installdir-64')).toBeNull()
  })
})

describe('parseDimCurrentUser', () => {
  it('reads the account name rather than assuming "Account"', () => {
    expect(parseDimCurrentUser('[General]\nCurrentUser=Remo\n')).toBe('Remo')
  })

  it('returns empty when the key is missing', () => {
    expect(parseDimCurrentUser('[General]\nApplicationVersion=1.4.1.96\n')).toBe('')
  })
})

describe('parseDimAccountIni', () => {
  it('reads every path the studio needs', () => {
    const paths = parseDimAccountIni(ACCOUNT_INI)
    expect(paths.library).toBe('D:/DAZ 3D/My DAZ 3D Library')
    expect(paths.manifests).toBe('D:/DAZ 3D/Install Manager/ManifestFiles')
    expect(paths.downloads).toBe('D:/DAZ 3D/Install Manager/Downloads')
    expect(paths.thumbnails).toBe('D:/DAZ 3D/Install Manager/Thumbnails')
    expect(paths.software64).toBe('C:/Program Files')
  })

  it('reads the content libraries as a list, not just the current one', () => {
    expect(parseDimAccountIni(ACCOUNT_INI).libraries).toEqual([
      { title: 'My DAZ 3D Library', path: 'D:/DAZ 3D/My DAZ 3D Library' },
    ])
  })

  it("does not confuse another section's `size` with the library count", () => {
    // [ApplicationTags] carries `size=37` right after [InstallPaths]' `size=1`.
    // A section-blind parser reads 37 libraries, 36 of them empty.
    expect(parseDimAccountIni(ACCOUNT_INI).libraries).toHaveLength(1)
  })

  it('leaves an absent override empty rather than inventing a default', () => {
    // No OverrideManifestDir = a default install, where the manifests live
    // under Public Documents. The caller resolves that; the parser does not guess.
    const noOverride = ACCOUNT_INI.replace(/OverrideManifestDir=.*\n/, '')
    expect(parseDimAccountIni(noOverride).manifests).toBe('')
    expect(parseDimAccountIni(noOverride).library).toBe('D:/DAZ 3D/My DAZ 3D Library')
  })

  it('NEVER returns the stored credential', () => {
    // The account file sits next to `RememberPassword=true` and holds the user's
    // Daz login as a hex blob. The parser is a named whitelist precisely so this
    // cannot reach settings.json, a log or a report — and this is the test that
    // keeps it that way if someone later makes it generic.
    const serialized = JSON.stringify(parseDimAccountIni(ACCOUNT_INI))
    expect(serialized).not.toContain('DEADBEEF')
    expect(serialized.toLowerCase()).not.toContain('password')
    expect(serialized.toLowerCase()).not.toContain('accounttitle')
  })

  it('survives a missing or malformed file', () => {
    expect(parseDimAccountIni('').library).toBe('')
    expect(parseDimAccountIni('').libraries).toEqual([])
  })
})
