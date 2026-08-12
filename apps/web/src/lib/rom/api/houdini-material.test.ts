import { describe, expect, it } from 'vitest'

import { discardHoudiniBackups, isSameNode, isStudioBackup, transferHoudiniMaterials } from './houdini-material.ts'

// The transfer itself needs hython and a real `.hip`, so what is unit-testable
// here is the guard that decides a transfer must not run at all â€” the one rule
// that protects a user's project from being opened and re-saved as its own
// target (append would double the node's bakers; replace would rewrite the file
// to produce what it already had).

describe('isSameNode', () => {
  const node = { hipPath: 'D:/chars/Ita/houdini/Ita.hiplc', nodePath: '/obj/DazToHue/DazToHueMaterial' }

  it('matches the same node regardless of separators or case', () => {
    // The target list comes from a Houdini scan, the source may come from a
    // file picker â€” the two spellings of one file must not read as two files.
    expect(
      isSameNode(node, {
        hipPath: 'd:\\chars\\Ita\\houdini\\ita.hiplc',
        nodePath: '/obj/DazToHue/DazToHueMaterial',
      }),
    ).toBe(true)
  })

  it('does not match a different node in the same project', () => {
    expect(isSameNode(node, { ...node, nodePath: '/obj/DazToHue/DazToHueMaterial1' })).toBe(false)
  })

  it('does not match the same node path in a different project', () => {
    expect(isSameNode(node, { ...node, hipPath: 'D:/chars/Kira/houdini/Kira.hiplc' })).toBe(false)
  })

  it('compares node paths case-SENSITIVELY (Houdini node names are)', () => {
    expect(isSameNode(node, { ...node, nodePath: '/obj/daztohue/daztohuematerial' })).toBe(false)
  })
})

describe('isStudioBackup', () => {
  // The gate on a DELETE, so what matters is everything it must refuse. The
  // studio's own copies are the only files the discard may ever remove.
  it('accepts the copies `_backup` writes', () => {
    expect(isStudioBackup('D:/chars/Ita/houdini/backup/Ita_dthbak.hiplc')).toBe(true)
    expect(isStudioBackup('D:\\chars\\Ita\\houdini\\backup\\Ita_dthbak.hip')).toBe(true)
    // Trailing whitespace off a report field must not defeat the check.
    expect(isStudioBackup(' D:/chars/Ita/houdini/backup/Ita_dthbak.hiplc ')).toBe(true)
  })

  it("refuses Houdini's own backups in the same folder", () => {
    // These sit right beside ours and are the user's safety net, not the
    // studio's â€” deleting one would be the worst kind of tidy-up.
    expect(isStudioBackup('D:/chars/Ita/houdini/backup/Ita_bak1.hip')).toBe(false)
    expect(isStudioBackup('D:/chars/Ita/houdini/backup/Ita_bak12.hiplc')).toBe(false)
  })

  it('refuses a project file, however similarly named', () => {
    expect(isStudioBackup('D:/chars/Ita/houdini/Ita.hiplc')).toBe(false)
    expect(isStudioBackup('D:/chars/Ita/houdini/Ita_dthbak')).toBe(false)
    // A folder named like a backup is not a backup file.
    expect(isStudioBackup('D:/chars/Ita/houdini/Ita_dthbak.hiplc/scene.hip')).toBe(false)
  })
})

describe('discardHoudiniBackups', () => {
  it('needs the desktop app', async () => {
    await expect(
      discardHoudiniBackups({ data: { paths: ['D:/x/backup/x_dthbak.hiplc'] } }),
    ).rejects.toThrow(/desktop app/i)
  })

  it('rejects a path that is not a string at the schema boundary', async () => {
    await expect(discardHoudiniBackups({ data: { paths: [''] } })).rejects.toThrow()
  })
})

describe('transferHoudiniMaterials', () => {
  const source = {
    hipPath: 'D:/chars/Kira/houdini/Kira.hiplc',
    nodePath: '/obj/DazToHue/DazToHueMaterial',
  }

  it('refuses a run whose target list contains the source node', async () => {
    await expect(
      transferHoudiniMaterials({
        data: {
          source,
          targets: [{ hipPath: 'd:\\chars\\Kira\\houdini\\kira.hiplc', nodePath: source.nodePath }],
          sections: ['bakers'],
          replace: false,
          dryRun: false,
        },
      }),
    ).rejects.toThrow(/source node is also a target/i)
  })

  it('rejects an empty target list at the schema boundary', async () => {
    await expect(
      transferHoudiniMaterials({
        data: { source, targets: [], sections: ['bakers'], replace: false, dryRun: true },
      }),
    ).rejects.toThrow()
  })

  it('rejects a run that would copy nothing', async () => {
    // Every section unticked is a no-op that still opens and re-saves the
    // user's project â€” refused at the schema, not silently performed.
    await expect(
      transferHoudiniMaterials({
        data: {
          source,
          targets: [{ hipPath: 'D:/chars/Ita/houdini/Ita.hiplc', nodePath: '/obj/x' }],
          sections: [],
          replace: false,
          dryRun: true,
        },
      }),
    ).rejects.toThrow()
  })

  it('refuses a skeleton section on a material run', async () => {
    // The Python filters to sections it knows for that kind, so a stray one
    // would be dropped silently and the run would report success having copied
    // nothing. Refused at the boundary instead.
    await expect(
      transferHoudiniMaterials({
        data: {
          nodeType: 'material',
          source,
          targets: [{ hipPath: 'D:/chars/Ita/houdini/Ita.hiplc', nodePath: '/obj/x' }],
          sections: ['skinWeights'],
          replace: false,
          dryRun: true,
        },
      }),
    ).rejects.toThrow(/not a valid material section/i)
  })

  it('refuses a material section on a skeleton run', async () => {
    await expect(
      transferHoudiniMaterials({
        data: {
          nodeType: 'skeleton',
          source,
          targets: [{ hipPath: 'D:/chars/Ita/houdini/Ita.hiplc', nodePath: '/obj/x' }],
          sections: ['bakers'],
          replace: false,
          dryRun: true,
        },
      }),
    ).rejects.toThrow(/not a valid skeleton section/i)
  })

  it('refuses a skeleton section on an occlusion run', async () => {
    await expect(
      transferHoudiniMaterials({
        data: {
          nodeType: 'occlusion',
          source,
          targets: [{ hipPath: 'D:/chars/Ita/houdini/Ita.hiplc', nodePath: '/obj/x' }],
          sections: ['skinWeights'],
          replace: false,
          dryRun: true,
        },
      }),
    ).rejects.toThrow(/not a valid occlusion section/i)
  })

  it("refuses the groom node's own sections on the character occlusion run", async () => {
    // The two occlusion nodes SHARE a section key (`visualise`) and differ in
    // every other one â€” exactly the case where a stray key would otherwise be
    // dropped in the Python and report a successful no-op.
    await expect(
      transferHoudiniMaterials({
        data: {
          nodeType: 'occlusion',
          source,
          targets: [{ hipPath: 'D:/chars/Ita/houdini/Ita.hiplc', nodePath: '/obj/x' }],
          sections: ['textureStamp'],
          replace: false,
          dryRun: true,
        },
      }),
    ).rejects.toThrow(/not a valid occlusion section/i)
  })

  it('accepts the section both occlusion kinds share, on either kind', async () => {
    // `visualise` is valid on BOTH â€” the per-kind check must not reject a key
    // just because another kind also has it. These get past validation and
    // fail on the host check instead (no Tauri in a vitest run).
    await Promise.all(
      (['occlusion', 'groomOcclusion'] as const).map((nodeType) =>
        expect(
          transferHoudiniMaterials({
            data: {
              nodeType,
              source,
              targets: [{ hipPath: 'D:/chars/Ita/houdini/Ita.hiplc', nodePath: '/obj/x' }],
              sections: ['visualise'],
              replace: false,
              dryRun: true,
            },
          }),
        ).rejects.toThrow(/desktop app/i),
      ),
    )
  })

  it('rejects an unknown section name', async () => {
    await expect(
      transferHoudiniMaterials({
        data: {
          source,
          targets: [{ hipPath: 'D:/chars/Ita/houdini/Ita.hiplc', nodePath: '/obj/x' }],
          sections: ['shaders'],
          replace: false,
          dryRun: true,
        },
      }),
    ).rejects.toThrow()
  })
})
