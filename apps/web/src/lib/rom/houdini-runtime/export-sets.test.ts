import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Which DazToHue network a node belongs to — the Python half, tested for real.
//
// The rule used to ask a node's PARENT and take the first `daztohueimport`
// child it found. Measured 2026-08-21 on a real project: `/obj/DazToHue` held
// TWO complete networks side by side (`DazToHueSkeleton` + `DazToHueSkeleton1`,
// `DazToHueMaterial` + `DazToHueMaterial1`, …), so both export nodes answered
// with the FIRST import node's name, `_scene_export_sets` deduped the two
// identical answers, and the DTH Export panel showed a two-network project as
// writing ONE export set. The stored scan said `exportSets: ['LaraClassic']`
// where the file holds LaraClassic and LaraNaked.
//
// Nothing on the studio side could catch that: the scan runs inside hython, and
// the Playwright fake echoes stored scan JSON back rather than producing it. So
// this EXTRACTS the real functions verbatim and execs them under a stock
// interpreter against fake nodes — the same trick `retarget-value.test.ts` uses,
// for the same reason (`material_utils.py` does `import hou` at module scope and
// cannot be imported outside Houdini).

const MATERIAL_UTILS = new URL('./material_utils.py', import.meta.url)
const RUNTIME_456 = new URL('./456.py', import.meta.url)

/** One top-level `def` and its body, lifted verbatim: the def line plus every
 *  indented or blank line until the next line that starts at column 0. */
function pyFunction(source: string, name: string): string {
  const start = source.indexOf(`\ndef ${name}(`)
  if (start < 0) throw new Error(`no longer defines ${name}`)
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

/** A `.hip` as this test describes one: nodes with a type, a parent, wired
 *  inputs and parms. Enough for the rules under test and nothing more. */
interface FakeNode {
  path: string
  type: string
  /** Paths of the nodes wired into this one's inputs. */
  inputs?: Array<string>
  parms?: Record<string, string>
}

/**
 * Run the extracted rules over a fake scene, in ONE interpreter start.
 *
 * The driver builds `hou` from the node list: `path`, `type().name()`,
 * `parent()` (derived from the path), `children()` and `inputs()` are all the
 * real code touches.
 */
function scan(nodes: ReadonlyArray<FakeNode>): {
  exportSets: Array<string>
  poseAssets: Array<{ dth: string; csv: string }>
  targets: Array<{ node: string; dth: string }>
} {
  const dir = mkdtempSync(join(tmpdir(), 'dth-export-sets-'))
  const mu = readFileSync(MATERIAL_UTILS, 'utf8')
  const py456 = readFileSync(RUNTIME_456, 'utf8')
  const rulePath = join(dir, 'rule.py')
  const scenePath = join(dir, 'scene.json')
  const driverPath = join(dir, 'drive.py')

  writeFileSync(
    rulePath,
    [
      // `_norm_path` is a dependency of `_network_dth`; the export/pose-asset
      // readers are the subjects.
      pyFunction(mu, '_norm_path'),
      pyFunction(mu, '_import_nodes_in'),
      pyFunction(mu, '_upstream_import_node'),
      pyFunction(mu, '_import_parm_text'),
      pyFunction(mu, '_own_import_node'),
      pyFunction(mu, '_network_character_name'),
      pyFunction(mu, '_network_dth'),
      pyFunction(mu, '_scene_export_sets'),
      pyFunction(mu, '_scene_pose_assets'),
      // 456.py's own copy of the same question, at RUN time.
      pyFunction(py456, 'upstream_import_node'),
      pyFunction(py456, 'import_path_of'),
    ].join('\n\n\n'),
    'utf8',
  )
  writeFileSync(scenePath, JSON.stringify(nodes), 'utf8')
  writeFileSync(
    driverPath,
    `import io, json, os, sys


class Parm(object):
    def __init__(self, value):
        self.value = value

    def evalAsString(self):
        return self.value


class Type(object):
    def __init__(self, name):
        self._name = name

    def name(self):
        return self._name


class Node(object):
    def __init__(self, spec, scene):
        self._spec = spec
        self._scene = scene

    def path(self):
        return self._spec["path"]

    def type(self):
        return Type(self._spec["type"])

    def parm(self, name):
        parms = self._spec.get("parms") or {}
        return Parm(parms[name]) if name in parms else None

    def parent(self):
        head = self._spec["path"].rsplit("/", 1)[0]
        return self._scene.get(head)

    def children(self):
        prefix = self._spec["path"] + "/"
        return [
            n
            for p, n in sorted(self._scene.items())
            if p.startswith(prefix) and "/" not in p[len(prefix):]
        ]

    def inputs(self):
        return [self._scene.get(p) for p in (self._spec.get("inputs") or [])]


class Hou(object):
    def __init__(self, scene, order):
        self._scene = scene
        self._order = order

    def node(self, path):
        return self._scene.get(path) or Root(self._order)


class Root(object):
    def __init__(self, order):
        self._order = order

    def allSubChildren(self):
        return self._order

    def path(self):
        return "/"


with io.open(sys.argv[2], "r", encoding="utf-8") as handle:
    specs = json.load(handle)
scene = {}
for spec in specs:
    scene[spec["path"]] = Node(spec, scene)
# Implicit parents (/obj, /obj/DazToHue) so parent()/children() behave.
for spec in list(specs):
    parts = spec["path"].split("/")
    for i in range(2, len(parts)):
        head = "/".join(parts[:i])
        if head and head not in scene:
            holder = {"path": head, "type": "subnet"}
            scene[head] = Node(holder, scene)
order = [scene[spec["path"]] for spec in specs]
hou = Hou(scene, order)

with io.open(sys.argv[1], "r", encoding="utf-8") as handle:
    exec(handle.read(), globals())

EXPORT_TYPE_NAMES = ("daztohueexport", "daztohuegroomexport")


def is_export_node(node):
    return node.type().name().lower() in EXPORT_TYPE_NAMES


targets = [
    {"node": n.path(), "dth": import_path_of(n)} for n in order if is_export_node(n)
]
sys.stdout.write(
    json.dumps(
        {
            "exportSets": _scene_export_sets(),
            "poseAssets": _scene_pose_assets(),
            "targets": targets,
        }
    )
)
`,
    'utf8',
  )
  return JSON.parse(
    execFileSync(python, [driverPath, rulePath, scenePath], { encoding: 'utf8' }),
  ) as ReturnType<typeof scan>
}

/** One DazToHue network, wired the way the HDA wires one: import → export, with
 *  a PoseAsset hanging off the same stream. `n` suffixes the node names the way
 *  Houdini does for a second copy in the same parent. */
function network(
  parent: string,
  suffix: string,
  character: string,
  dth: string,
  csv?: string,
): Array<FakeNode> {
  const imp = `${parent}/DazToHueImport${suffix}`
  const nodes: Array<FakeNode> = [
    {
      path: imp,
      type: 'daztohueimport',
      parms: { import_character_name: character, import_character_dtu_file: dth },
    },
    { path: `${parent}/DazToHueExport${suffix}`, type: 'daztohueexport', inputs: [imp] },
  ]
  if (csv !== undefined) {
    nodes.push({
      path: `${parent}/DazToHuePoseAsset${suffix}`,
      type: 'daztohueposeasset',
      inputs: [imp],
      parms: { pose_asset_csv_file_path: csv },
    })
  }
  return nodes
}

// Skipping quietly is how a check dies unnoticed, so CI does not get the
// option: ubuntu-latest ships python3, and a runner that stops shipping it
// FAILS here rather than going green on nothing. This is a real test, not a
// comment about one — the version that only `console.warn`ed while
// `describe.skip` swallowed the suite in CI too said exactly this and did
// none of it. On a dev box without python the suite skips, and says so.
if (process.env.CI) {
  it('CI has a python3 to run the Houdini network rule under', () => {
    expect(python).not.toBe('')
  })
} else if (!python) {
  console.warn('[export-sets] no python3 on PATH — the Houdini network rule was NOT tested')
}

const maybe = python ? describe : describe.skip

maybe('two networks in ONE parent — the measured project', () => {
  // `/obj/DazToHue` holding both, which is what the real LaraCroft_G81.hiplc
  // does. Every node name carries Houdini's `1` suffix for the second copy.
  const scene = [
    ...network('/obj/DazToHue', '', 'LaraClassic', 'D:/x/primary/LaraCroft_G81.dth', 'D:/x/primary/LaraCroft_G81_pose_asset.csv'),
    ...network('/obj/DazToHue', '1', 'LaraNaked', 'D:/x/naked/LaraNaked.dth', 'D:/x/naked/LaraNaked_pose_asset.csv'),
  ]

  it('reports BOTH export sets, not the first one twice', () => {
    // The bug, exactly: this used to be ['LaraClassic'] because both export
    // nodes asked their shared parent and got its first import node.
    expect(scan(scene).exportSets).toEqual(['LaraClassic', 'LaraNaked'])
  })

  it('pairs each PoseAsset CSV with its OWN network’s .dth', () => {
    // Both used to come back paired against the first network's `.dth`, which
    // is precisely the mismatch the csv-consistency check exists to catch —
    // reported as a fault against a project that had none, and blind to a real
    // one.
    expect(scan(scene).poseAssets).toEqual([
      { dth: 'd:/x/primary/laracroft_g81.dth', csv: 'd:/x/primary/laracroft_g81_pose_asset.csv' },
      { dth: 'd:/x/naked/laranaked.dth', csv: 'd:/x/naked/laranaked_pose_asset.csv' },
    ])
  })

  it('gives each export node its OWN .dth at run time (456.py)', () => {
    // The run-time half. With both nodes answering the first import's `.dth`,
    // ticking only the SECOND network's scene matched nothing at all, and
    // ticking the first exported both.
    expect(scan(scene).targets).toEqual([
      { node: '/obj/DazToHue/DazToHueExport', dth: 'D:/x/primary/LaraCroft_G81.dth' },
      { node: '/obj/DazToHue/DazToHueExport1', dth: 'D:/x/naked/LaraNaked.dth' },
    ])
  })
})

maybe('the ordinary shapes still answer the way they did', () => {
  it('one network per subnet', () => {
    const scene = [
      ...network('/obj/DazToHue', '', 'LaraClassic', 'D:/x/primary/a.dth'),
      ...network('/obj/DazToHue1', '', 'LaraNaked', 'D:/x/naked/b.dth'),
    ]
    expect(scan(scene).exportSets).toEqual(['LaraClassic', 'LaraNaked'])
  })

  it('a single network, the shape every generated project has', () => {
    expect(scan(network('/obj/DazToHue', '', 'Kira', 'D:/x/primary/Kira.dth')).exportSets).toEqual([
      'Kira',
    ])
  })

  it('falls back to the parent’s SOLE import when nothing is wired', () => {
    // A hand-built project whose export node is not fed from the import (or a
    // wire this walk cannot follow). One import in the parent is unambiguous,
    // so the old answer is still the right one.
    const scene: Array<FakeNode> = [
      {
        path: '/obj/DazToHue/DazToHueImport',
        type: 'daztohueimport',
        parms: { import_character_name: 'Kira', import_character_dtu_file: 'D:/x/Kira.dth' },
      },
      { path: '/obj/DazToHue/DazToHueExport', type: 'daztohueexport' },
    ]
    expect(scan(scene).exportSets).toEqual(['Kira'])
  })

  it('says NOTHING rather than guessing when unwired and the parent is ambiguous', () => {
    // Two imports, no wire to follow: naming one of them is a coin flip, and a
    // wrong name is worse than a missing one — the reader treats a name it
    // cannot match as "not in this project" (un-ticks a row), while a
    // confidently wrong one ticks the WRONG row.
    const scene: Array<FakeNode> = [
      {
        path: '/obj/DazToHue/DazToHueImport',
        type: 'daztohueimport',
        parms: { import_character_name: 'LaraClassic', import_character_dtu_file: 'D:/x/a.dth' },
      },
      {
        path: '/obj/DazToHue/DazToHueImport1',
        type: 'daztohueimport',
        parms: { import_character_name: 'LaraNaked', import_character_dtu_file: 'D:/x/b.dth' },
      },
      { path: '/obj/DazToHue/DazToHueExport', type: 'daztohueexport' },
    ]
    expect(scan(scene).exportSets).toEqual([])
    expect(scan(scene).targets).toEqual([{ node: '/obj/DazToHue/DazToHueExport', dth: '' }])
  })

  it('walks THROUGH intermediate nodes to reach the import', () => {
    // Nothing says the import is wired straight into the export — a user's own
    // blast/attribwrangle can sit between them.
    const scene: Array<FakeNode> = [
      {
        path: '/obj/DazToHue/DazToHueImport',
        type: 'daztohueimport',
        parms: { import_character_name: 'Kira', import_character_dtu_file: 'D:/x/Kira.dth' },
      },
      {
        path: '/obj/DazToHue/attribwrangle1',
        type: 'attribwrangle',
        inputs: ['/obj/DazToHue/DazToHueImport'],
      },
      {
        path: '/obj/DazToHue/DazToHueExport',
        type: 'daztohueexport',
        inputs: ['/obj/DazToHue/attribwrangle1'],
      },
    ]
    expect(scan(scene).exportSets).toEqual(['Kira'])
  })

  it('does not mistake the GROOM importer for the character importer', () => {
    // `daztohuegroomimport` does NOT contain `daztohueimport` — the substring
    // test every reader here shares depends on that, and a groom import wired
    // nearer the export node must not win.
    const scene: Array<FakeNode> = [
      {
        path: '/obj/DazToHue/DazToHueImport',
        type: 'daztohueimport',
        parms: { import_character_name: 'Kira', import_character_dtu_file: 'D:/x/Kira.dth' },
      },
      {
        path: '/obj/DazToHue/DazToHueGroomImport',
        type: 'daztohuegroomimport',
        inputs: ['/obj/DazToHue/DazToHueImport'],
        parms: { import_character_name: 'NotThis', import_character_dtu_file: 'D:/x/no.dth' },
      },
      {
        path: '/obj/DazToHue/DazToHueExport',
        type: 'daztohueexport',
        inputs: ['/obj/DazToHue/DazToHueGroomImport'],
      },
    ]
    expect(scan(scene).exportSets).toEqual(['Kira'])
  })

  it('survives a wiring CYCLE instead of hanging the scan', () => {
    // A SOP network cannot really cycle, but the walk is defensive because a
    // scan that hangs costs the whole Utils drawer, and the visited set is the
    // only thing standing between "cheap" and "forever".
    const scene: Array<FakeNode> = [
      { path: '/obj/DazToHue/a', type: 'null', inputs: ['/obj/DazToHue/b'] },
      { path: '/obj/DazToHue/b', type: 'null', inputs: ['/obj/DazToHue/a'] },
      { path: '/obj/DazToHue/DazToHueExport', type: 'daztohueexport', inputs: ['/obj/DazToHue/a'] },
    ]
    expect(scan(scene).exportSets).toEqual([])
  })

  it('still dedupes two nodes that really do write the same set', () => {
    // Two export nodes fed by ONE import: one set, named once. The dedupe is
    // not what was wrong — what it was fed was.
    const scene: Array<FakeNode> = [
      {
        path: '/obj/DazToHue/DazToHueImport',
        type: 'daztohueimport',
        parms: { import_character_name: 'Kira', import_character_dtu_file: 'D:/x/Kira.dth' },
      },
      {
        path: '/obj/DazToHue/DazToHueExport',
        type: 'daztohueexport',
        inputs: ['/obj/DazToHue/DazToHueImport'],
      },
      {
        path: '/obj/DazToHue/DazToHueGroomExport',
        type: 'daztohuegroomexport',
        inputs: ['/obj/DazToHue/DazToHueImport'],
      },
    ]
    expect(scan(scene).exportSets).toEqual(['Kira'])
  })
})
