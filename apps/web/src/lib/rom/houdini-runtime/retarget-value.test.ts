import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The Python half of the rename retarget, tested for real.
//
// `_retarget_value` is the one rule in this repo that rewrites paths INSIDE a
// user's `.hip` without verifying anything on disk — by design, since a rename
// clears the old export set and the new one does not exist until the user
// re-exports (`op_retarget`'s docstring). That makes it both the piece most
// worth pinning and the piece a smoke spec cannot reach: the Playwright fake
// echoes the studio's request back, it never runs the rule.
//
// `material_utils.py` does `import hou` at module scope, so it cannot be
// imported outside Houdini. These two functions are pure string work with no
// Houdini dependency, so this EXTRACTS their source verbatim and execs it under
// a stock interpreter — the real code, not a mirror that can drift.

const PY = new URL('./material_utils.py', import.meta.url)

/** One top-level `def` and its body, lifted verbatim: the def line plus every
 *  indented or blank line until the next line that starts at column 0. */
function pyFunction(source: string, name: string): string {
  const start = source.indexOf(`\ndef ${name}(`)
  if (start < 0) throw new Error(`material_utils.py no longer defines ${name}`)
  const lines = source.slice(start + 1).split('\n')
  const out = [lines[0]]
  for (const line of lines.slice(1)) {
    if (line.trim() !== '' && !/^\s/.test(line)) break
    out.push(line)
  }
  return out.join('\n').replace(/\s+$/, '')
}

/** A stock Python 3, or ''. Linux/macOS spell it `python3`, a Windows dev box
 *  `python`; a bare Windows install may only answer to the `py` launcher. */
function findPython(): string {
  for (const candidate of ['python3', 'python', 'py']) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], {
      encoding: 'utf8',
    })
    if (probe.status === 0 && probe.stdout.trim() === '3') return candidate
  }
  return ''
}

const python = findPython()
// Skipping quietly is how a check dies unnoticed, so CI does not get the
// option: ubuntu-latest ships python3, and a runner that stops shipping it
// should fail here loudly rather than go green on nothing. A contributor
// without Python still gets a green `pnpm test` — plus a line saying what did
// not run.
if (!python && !process.env.CI) {
  console.warn('[retarget-value] no python3 on PATH — the Houdini retarget rule was NOT tested')
}

type Case = [value: string, nameFrom: string, nameTo: string, folderFrom: string, folderTo: string]

/** Every case through the extracted rule in ONE interpreter start — a process
 *  per case costs seconds on Windows for nothing. */
function retargetAll(cases: ReadonlyArray<Case>): Array<string | null> {
  const dir = mkdtempSync(join(tmpdir(), 'dth-retarget-'))
  const source = readFileSync(PY, 'utf8')
  const rulePath = join(dir, 'rule.py')
  const casesPath = join(dir, 'cases.json')
  const driverPath = join(dir, 'drive.py')
  writeFileSync(
    rulePath,
    `${pyFunction(source, '_swap_leaf')}\n\n\n${pyFunction(source, '_retarget_value')}\n`,
    'utf8',
  )
  writeFileSync(casesPath, JSON.stringify(cases), 'utf8')
  writeFileSync(
    driverPath,
    [
      'import io, json, sys',
      'with io.open(sys.argv[1], "r", encoding="utf-8") as handle:',
      '    exec(handle.read(), globals())',
      'with io.open(sys.argv[2], "r", encoding="utf-8") as handle:',
      '    cases = json.load(handle)',
      'sys.stdout.write(json.dumps([_retarget_value(*case) for case in cases]))',
      '',
    ].join('\n'),
    'utf8',
  )
  return JSON.parse(
    execFileSync(python, [driverPath, rulePath, casesPath], { encoding: 'utf8' }),
  ) as Array<string | null>
}

const FROM = 'D:/chars/Ita'
const TO = 'D:/chars/Nova'
const rename = (value: string): Case => [value, 'Ita', 'Nova', FROM, TO]
/** The character folder did NOT move — a rename that only changed the
 *  definition's name, or a case-only one, which `movedFrom` answers '' for.
 *  The leaf swap is then on its own. */
const nameOnly = (value: string, from = 'Ita', to = 'Nova'): Case => [value, from, to, '', '']

const TABLE: Array<[label: string, input: Case, expected: string | null]> = [
  // --- the measured export set: ONE prefix rule on the last segment ---------
  ['the .dth', rename('$HIP/daz-export/primary/Ita.dth'), '$HIP/daz-export/primary/Nova.dth'],
  [
    'the experimental ROM, and $JOB stays $JOB',
    rename('$JOB/daz-export/primary/Ita_experimental_rom.fbx'),
    '$JOB/daz-export/primary/Nova_experimental_rom.fbx',
  ],
  [
    'a groom Alembic, scene suffix and item name riding along',
    rename('$HIP/daz-export/primary/Ita_Hair_Bob_grooms.abc'),
    '$HIP/daz-export/primary/Nova_Hair_Bob_grooms.abc',
  ],
  ['the PoseAsset CSV, relative', rename('Ita_pose_asset.csv'), 'Nova_pose_asset.csv'],
  [
    'a reference skeleton, two segments down',
    nameOnly('$HIP/daz-export/primary/Reference Skeletons/Ita_frame_12.fbx'),
    '$HIP/daz-export/primary/Reference Skeletons/Nova_frame_12.fbx',
  ],

  // --- both swaps at once, and each on its own ------------------------------
  [
    'an absolute reference: folder AND name',
    rename('D:/chars/Ita/houdini/daz-export/primary/Ita.abc'),
    'D:/chars/Nova/houdini/daz-export/primary/Nova.abc',
  ],
  [
    'backslashes normalize, and still swap',
    rename('D:\\chars\\Ita\\houdini\\daz-export\\primary\\Ita.fbx'),
    'D:/chars/Nova/houdini/daz-export/primary/Nova.fbx',
  ],
  [
    'the folder alone, when the old name is nowhere in the path',
    rename('D:/chars/Ita/houdini/scene_backup.hip'),
    'D:/chars/Nova/houdini/scene_backup.hip',
  ],
  [
    'the name alone, when the folder did not move',
    nameOnly('D:/chars/Ita/x/Ita.dth'),
    'D:/chars/Ita/x/Nova.dth',
  ],
  ['the character folder itself', rename('D:/chars/Ita'), 'D:/chars/Nova'],

  // --- the trailing slash is load-bearing on `export_directory` -------------
  [
    'export_directory keeps its trailing slash',
    rename('D:/chars/Ita/export/'),
    'D:/chars/Nova/export/',
  ],
  [
    'a hand-pointed export_directory swaps its name-derived leaf too',
    rename('D:/chars/Ita/export/Ita/'),
    'D:/chars/Nova/export/Nova/',
  ],

  // --- what it must NOT touch ----------------------------------------------
  ['an unrelated reference', rename('$HIP/geo/teapot.bgeo'), null],
  ['an empty value', rename(''), null],
  [
    'a LONGER folder that merely starts with the old name — no separator',
    rename('D:/chars/Italy/houdini/Italy.abc'),
    null,
  ],
  ['a leaf that only shares the prefix — no `_`/`.` boundary', nameOnly('$HIP/x/Italy.abc'), null],

  // --- the awkward real ones -----------------------------------------------
  [
    'a case-different spelling of the same folder, rewritten to the real one',
    rename('d:/CHARS/ita/houdini/x/Ita.dth'),
    'D:/chars/Nova/houdini/x/Nova.dth',
  ],
  [
    'a case-only rename is still a rename',
    nameOnly('$HIP/x/ita.dth', 'ita', 'Ita'),
    '$HIP/x/Ita.dth',
  ],
  [
    'a name with a space (exporterFigureName keeps them)',
    nameOnly('$HIP/x/Kira Smith.dth', 'Kira Smith', 'Nova'),
    '$HIP/x/Nova.dth',
  ],
  [
    // The KNOWN limit, pinned so it is a decision rather than a surprise: only
    // the LAST segment is name-swapped, so a reference reaching INTO the final
    // export tree keeps the old name in the middle folder and in the HDA's own
    // `SKM_` prefix. Nothing the studio emits stores such a path — the HDA
    // builds that tree from `export_directory` + `import_character_name` at
    // cook time — and on a user's own node it comes back in `foreign` rather
    // than being rewritten. If either stops being true, this is the case to fix.
    'a path INTO the final tree is only half-swapped (known limit)',
    rename('D:/chars/Ita/export/Ita/Skeletal Meshes/SKM_Ita.fbx'),
    'D:/chars/Nova/export/Ita/Skeletal Meshes/SKM_Ita.fbx',
  ],
]

describe.skipIf(!python)('_retarget_value (material_utils.py, run under python)', () => {
  // One assertion over the whole table, keyed by label: a failure names the
  // case that broke instead of stopping at the first one.
  it('answers every measured case exactly', () => {
    const answers = retargetAll(TABLE.map(([, input]) => input))
    expect(Object.fromEntries(TABLE.map(([label], i) => [label, answers[i]]))).toEqual(
      Object.fromEntries(TABLE.map(([label, , expected]) => [label, expected])),
    )
  })
})
