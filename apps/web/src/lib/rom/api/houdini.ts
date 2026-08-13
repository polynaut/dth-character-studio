import { copyFile, exists, mkdir, readTextFile, remove, rename } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { houdiniVersionFromInstall, matchingHoudiniDocsFolder } from '#/lib/houdini-version.ts'
import {
  LEGACY_EXPORTS_FOLDER,
  characterHoudiniDir,
  characterHoudiniProjectDir,
  hipAnchorDirs,
  hipRefPrefixFor,
} from '#/lib/scene-subfolder.ts'
import {
  HOUDINI_CONSOLE_FILE,
  HOUDINI_HEADLESS_RUNNER,
  HOUDINI_JOB_FILE,
  HOUDINI_RESULT_FILE,
  HOUDINI_RUN_FILE,
  HOUDINI_SCRIPTS_FOLDER,
  buildHoudiniJob,
  buildHoudiniPrefill,
  houdiniRunFilesToClear,
  houdiniRunLooksDead,
  houdiniRunStateFrom,
  parseHoudiniResult,
  sceneDthPath,
} from '../houdini-jobs'
import { normalizeSceneKey } from '../execute-jobs'
import type { HoudiniResult, HoudiniRunState } from '../houdini-jobs'
import type { Character } from '@dth/rom'
// Houdini's half of the handoff, bundled as source and written into app-data
// before each launch (see startHoudiniExport).
import houdiniRunnerScript from '../houdini-runtime/456.py?raw'
// The hython bootstrap the HEADLESS launch runs: loads the .hip, then runs
// 456.py exactly once (its docstring carries the double-run story).
import houdiniHeadlessRunner from '../houdini-runtime/headless_export.py?raw'
import { characterScenesRoot } from './execute'
import { normalizeRelFolder } from '../library'
import { DTH_FPS } from '../houdini-defaults.ts'
import { normalizePathLower } from '#/lib/path.ts'
import { charScopeInput, charsRoot, joinPath, locateCharacter, resolveProject } from './core'

// "Generate project": create a ready-made DazToHue Houdini project for a
// character. hython starts a fresh scene, bakes $JOB to the character's ONE
// shared `houdini-project` folder, puts the timeline on the pipeline's 30 fps,
// creates the DazToHue network FROM THE USER'S
// INSTALLED HDA (no template scene: a template would rot against newer
// Houdini/DazToHue versions; instantiating the installed asset is always
// current) and saves <name>.hiplc beside that folder. Path resolution lives
// here; the folder-create + hython run are native (create_houdini_project,
// houdini.rs).
//
// The character's export root sits in the HOUDINI folder as `daz-export`,
// one hop from every `.hip` that reads it, reached by plain relative
// navigation (`$JOB/<houdiniSubdir>/daz-export/…`, runtime v64). Earlier
// versions planted `dth-exports` JUNCTIONS here and beside every `.hip` to fake
// exactly that adjacency; the feature was killed (v0.63) — reparse points fought
// Perforce/backup tooling and doubled the folder in every picker — and
// {@link sweepExportJunctions} now REMOVES the leftovers from exactly the places
// the old code created them.

const generateInput = charScopeInput.extend({
  /** The new scene's name (dialog input, prefilled `<Project>_<Character>`). */
  sceneName: z.string().min(1),
  /** Which linked Daz scene the network should import — the dialog's picker on
   *  a multi-scene character. Empty (or a scene this character doesn't link)
   *  means the primary, which is the single-scene case and the old behaviour. */
  dazScenePath: z.string().default(''),
})

/** Folder/file-name-safe: Windows-illegal characters collapse to one space
 *  (the same rule as the Houdini project folder input). */
function cleanFileName(value: string): string {
  return value
    .trim()
    .replace(/[\r\n<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The `.hiplc` path a dialog name generates to ('' when either part is
 *  empty) — inside the character's HOUDINI folder, beside the shared
 *  `houdini-project` folder it Set-Projects to. ONE computation shared by the
 *  generate itself and the dialog's live name-collision check — the two must
 *  never disagree on the target. */
export function generatedHoudiniScenePath(houdiniDir: string, sceneName: string): string {
  const name = cleanFileName(sceneName)
  const dir = houdiniDir.trim().replace(/\\/g, '/')
  if (!name || !dir) return ''
  return joinPath(dir, `${name}.hiplc`)
}

/**
 * Remove leftover `dth-exports` JUNCTIONS from EXACTLY the places the old
 * junction feature created them: beside every linked `.hip` inside the
 * character folder (the {@link hipAnchorDirs} set), the character's houdini
 * folder itself, and the (retired) `houdini-project/` folder. Runs from the one
 * funnel every generation already goes through (`generateCharacterFiles`), so
 * existing projects lose their junctions on the next save/refresh without a
 * separate migration.
 *
 * It hunts {@link LEGACY_EXPORTS_FOLDER} — the name the junctions carried —
 * NOT the current {@link EXPORTS_FOLDER}. The live export root now sits
 * inside the houdini folder, which is one of the folders swept here, so aiming
 * this at the current name would point a delete straight at the real thing.
 *
 * Strictly reparse-point-safe on top of that: the Rust side (`remove_junction`)
 * verifies the path IS a junction before removing it and refuses a real folder.
 * Two independent reasons the export root cannot be touched, which is the right
 * number for a sweep that deletes.
 *
 * Returns the paths actually removed, so Refresh assets can report them.
 */
export async function sweepExportJunctions(
  character: Character,
  charFolderAbs: string,
  houdiniSubdir?: string,
): Promise<Array<string>> {
  if (!charFolderAbs || !isTauri()) return []
  const dirs = new Set<string>(hipAnchorDirs(character.houdiniProjects, charFolderAbs))
  const houdiniDir = characterHoudiniDir(charFolderAbs, houdiniSubdir)
  if (houdiniDir) dirs.add(houdiniDir)
  const projectDir = characterHoudiniProjectDir(charFolderAbs, houdiniSubdir)
  if (projectDir) dirs.add(projectDir)
  const removed: Array<string> = []
  for (const dir of dirs) {
    const link = joinPath(dir, LEGACY_EXPORTS_FOLDER)
    try {
      // A primitive return — z.enum, not a bare invoke<T>() cast (no fixture
      // needed; see the FFI ritual in .ai/conventions.md).
      const state = z
        .enum(['removed', 'absent', 'not-a-junction'])
        .parse(await invoke('remove_junction', { request: { linkPath: link } }))
      if (state === 'removed') removed.push(link)
    } catch {
      // locked or unreadable — the next generation sweeps again
    }
  }
  return removed
}

/**
 * Remove the leftover `houdini-project/` folder (retired in v0.68).
 *
 * It was created as the shared "project folder" every generated scene would
 * `Set Project` to. That could never work as intended: Houdini's own output
 * (render/, geo/, backup/) is written relative to **`$HIP`**, and `$HIP` is
 * DERIVED from the folder the `.hip` sits in — Set Project sets `$JOB`, not
 * `$HIP`. So the output always landed beside the scenes in the houdini folder
 * (which is itself shared by every scene of the character, giving exactly the
 * one-folder tidiness the subfolder was meant to provide) and `houdini-project`
 * stayed empty.
 *
 * **Only ever removes it when EMPTY.** A pre-v0.64 project had `$JOB` pointed
 * at this folder, so Houdini may genuinely have written caches or renders into
 * it — that is the user's own output and deleting it is not the studio's call.
 * A non-empty one is left exactly where it is and reported, so the user can
 * look before deciding. Same shape as the junction sweep: best-effort, run from
 * the generation funnel, no separate migration step.
 */
export async function sweepHoudiniProjectDirs(
  charFolderAbs: string,
  houdiniSubdir?: string,
): Promise<{ removed: Array<string>; kept: Array<string> }> {
  const empty = { removed: [], kept: [] }
  if (!charFolderAbs || !isTauri()) return empty
  const projectDir = characterHoudiniProjectDir(charFolderAbs, houdiniSubdir)
  if (!projectDir) return empty
  try {
    // A primitive return — z.enum, not a bare invoke<T>() cast (no fixture
    // needed; see the FFI ritual in .ai/conventions.md).
    const state = z
      .enum(['removed', 'absent', 'not-empty', 'not-a-directory'])
      .parse(await invoke('remove_dir_if_empty', { request: { dirPath: projectDir } }))
    if (state === 'removed') return { removed: [projectDir], kept: [] }
    if (state === 'not-empty') return { removed: [], kept: [projectDir] }
  } catch {
    // locked or unreadable — the next generation sweeps again
  }
  return empty
}

const copyProjectInput = charScopeInput.extend({
  /** The `.hip`/`.hiplc` to bring in. */
  hipPath: z.string().min(1),
  /** true = MOVE it (the original is removed once the copy is on disk). */
  deleteOriginal: z.boolean().default(false),
})

/**
 * Copy (or move) a Houdini project into the character's houdini folder.
 *
 * Linking in place used to be the only option, because a copied `.hip` arrives
 * BROKEN in ways the studio had no way to see or repair: it carries the source's
 * `$JOB` and its absolute file references, so its imports point at the character
 * it was copied FROM. That is no longer true — the background scan finds exactly
 * those faults, the card says so, and the Utils drawer repairs all of them
 * (`Repair project settings`, `Make paths portable`, `Fill network`). So the copy is offered,
 * and the caller is expected to point the user at those.
 *
 * Only the scene file moves. Houdini's own output beside it (`backup/`, `geo/`,
 * `render/`) belongs to the project it was produced in and is `$HIP`-relative —
 * dragging it along would put another character's caches in this one's folder.
 *
 * Refuses to overwrite: the destination name is the source's, and an existing
 * file there is someone else's project. Returns the new absolute path.
 */
export async function copyHoudiniProject({ data }: { data: unknown }): Promise<string> {
  const { projectId, id, hipPath, deleteOriginal } = copyProjectInput.parse(data)
  if (!isTauri()) throw new Error('Copying a Houdini project needs the desktop app.')
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, id)
  if (!location) throw new Error(`Character ${id} not found`)
  const destDir = characterHoudiniDir(location.folderAbs, project.houdiniSubdir)
  const name = hipPath.replace(/\\/g, '/').split('/').pop() ?? ''
  if (!name) throw new Error('That path has no file name.')
  const dest = joinPath(destDir, name)
  if (normalizePathLower(dest) === normalizePathLower(hipPath)) return hipPath
  if (await exists(dest)) {
    throw new Error(
      `A project called "${name}" is already in this character's Houdini folder:
${dest}
Rename one of them, or link the existing file instead.`,
    )
  }
  await mkdir(destDir, { recursive: true })
  // Native whole-file copy — a `.hip` runs to hundreds of MB and round-tripping
  // the bytes through the webview would double that in memory.
  await copyFile(hipPath, dest)
  if (deleteOriginal) {
    try {
      await remove(hipPath)
    } catch {
      // Leave a stray original rather than failing an operation that succeeded:
      // the copy is on disk and is what the character now links.
    }
  }
  return dest
}

const renameProjectInput = z.object({
  /** Absolute path of the linked project file to rename. It stays in its
   *  folder — only the file NAME changes. */
  hipPath: z.string().min(1),
  /** The new file name WITHOUT extension (one typed WITH it is accepted too —
   *  see {@link renameStem}). */
  newName: z.string().min(1),
})

/**
 * The stem to rename to, out of what the user typed. Two corrections, both of
 * things the card's own display invites:
 *
 * - **A repeated extension is dropped.** The card shows the name WITHOUT its
 *   suffix, so a user who types it back (`Lara.hiplc`) means one file — not
 *   `Lara.hiplc.hiplc`, which is what they used to get (measured).
 * - **Trailing dots and spaces go.** Windows silently drops them from a file
 *   name, so keeping them would save the project under a name the user cannot
 *   type back and the studio would then report as missing.
 *
 * A `while` loop, not `/[. ]+$/` — a `+` immediately before `$` is the
 * polynomial-ReDoS shape CodeQL flags (js/polynomial-redos). See
 * `.ai/gotchas.md`.
 */
function renameStem(typed: string, ext: string): string {
  let stem = typed.trim()
  if (ext && stem.toLowerCase().endsWith(ext.toLowerCase())) {
    stem = stem.slice(0, -ext.length)
  }
  while (stem.endsWith('.') || stem.endsWith(' ')) stem = stem.slice(0, -1)
  return stem
}

/**
 * Rename a linked Houdini project IN PLACE, keeping its extension. Returns the
 * renamed file's absolute path; the caller repoints `houdiniProjects`.
 *
 * **Renaming is safe where moving is not**, and that asymmetry is the reason
 * this exists at all while {@link copyHoudiniProject} stays a copy. Everything
 * the studio bakes into a generated project is anchored on a FOLDER variable —
 * `$JOB` (the character folder) and `$HIP` (the folder the scene file sits in) —
 * and neither one moves when the file is renamed. `$HIPNAME`/`$HIPFILE` would
 * follow the name, and nothing the studio writes uses them.
 *
 * The extension is CARRIED OVER, never assumed: a generated project is
 * `.hiplc`, but a hand-linked one can be `.hip` or `.hipnc`, and rewriting a
 * commercial `.hip` to `.hiplc` would tell Houdini the file is licence-limited.
 *
 * Refuses to overwrite — a file already sitting on that name is someone else's
 * project (or the same project's other build), and a rename is not a merge.
 */
export async function renameHoudiniProject({ data }: { data: unknown }): Promise<string> {
  const { hipPath, newName } = renameProjectInput.parse(data)
  const norm = hipPath.replace(/\\/g, '/')
  const cut = norm.lastIndexOf('/')
  // A path with no folder in it cannot be renamed in place, and must REFUSE
  // rather than improvise: `lastIndexOf` answering -1 made `slice(0, cut)` eat
  // the name's last character and invent a directory out of it (measured:
  // `Kira.hiplc` → `Kira.hipl/Lara.hiplc`). Every caller passes an absolute
  // linked path, so reaching this is a programming error, not a user one.
  if (cut < 0) throw new Error('Renaming a Houdini project needs its full path.')
  const dir = norm.slice(0, cut)
  const file = norm.slice(cut + 1)
  // `> 0`, not `>= 0`: a leading dot is a name, not an extension separator.
  const dot = file.lastIndexOf('.')
  const ext = dot > 0 ? file.slice(dot) : ''
  const clean = renameStem(newName, ext)
  // REJECT rather than silently clean (which is what the Generate dialog's
  // `cleanFileName` does to a value being typed for the first time): this name
  // replaces one the user already has, and quietly turning it into something
  // else is a worse answer than saying it cannot be used. `.` and `..` need no
  // case of their own — `renameStem` strips them to '' and they land here.
  if (!clean || /[\\/:*?"<>|]/.test(clean)) {
    throw new Error('Enter a plain file name (no slashes or special characters).')
  }
  // Browser build: no filesystem to rename on — report the path unchanged, so
  // the caller repoints nothing (the same "nothing happened" the pickers no-op to).
  if (!isTauri()) return hipPath
  const dest = `${dir}/${clean}${ext}`
  if (dest === norm) return hipPath
  // A CASE-only change is a real rename, not a no-op: fixing `lara` to `Lara`
  // is the whole point of an editable name. It skips the collision check
  // because on Windows the destination IS the source — `exists` answers true
  // and would refuse the user their own file.
  const caseOnly = dest.toLowerCase() === norm.toLowerCase()
  if (!caseOnly && (await exists(dest))) {
    throw new Error(`“${clean}${ext}” already exists in that folder.`)
  }
  await rename(hipPath, dest)
  return dest
}

export interface GeneratedHoudiniProject {
  /** Absolute path of the saved `.hiplc` — the caller links it. */
  scenePath: string
  /** Whether the DazToHue network was created from the installed HDA (false =
   *  hython couldn't see the HDA — the scene saved empty, `$JOB` still baked;
   *  the user adds the network from the DazToHue shelf). */
  networkAdded: boolean
  /** Every DazToHue-ish node type hython could see (`<category>/<type>`) —
   *  diagnosis when `networkAdded` is false: empty means the otls didn't load
   *  at all; SOP-only entries mean the main asset isn't an Object-level HDA. */
  visibleTypes: Array<string>
  /** `node.parm` entries the generation prefilled on the new network (import
   *  paths, PoseAsset CSV, skinning, export directory) — empty when the
   *  installed HDA predates a parm (each is skipped when absent) or the
   *  network wasn't built. */
  prefilled: Array<string>
  /** The timeline FPS the saved scene actually carries — READ BACK off
   *  `hou.fps()` after the set, never the value we asked for, so the caller can
   *  report a fact. `0` = hython could not answer. */
  fps: number
}

export async function generateHoudiniProject({
  data,
}: {
  data: unknown
}): Promise<GeneratedHoudiniProject> {
  const { projectId, id, sceneName, dazScenePath } = generateInput.parse(data)
  if (!isTauri()) throw new Error('Generate project needs the desktop app (it runs hython).')

  const settings = await storage.getSettings()
  const installDir = settings.houdiniInstallFolder.trim()
  if (!installDir) {
    throw new Error('Set the Houdini installation folder in Settings first — hython creates the project.')
  }
  const hythonPath = joinPath(installDir.replace(/\\/g, '/'), 'bin/hython.exe')
  if (!(await exists(hythonPath))) {
    throw new Error(`hython was not found:\n${hythonPath}\nCheck the Houdini installation folder in Settings.`)
  }
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, id)
  const character = location ? await storage.getCharacter(lib, id, location.definitionAbs) : null
  if (!location || !character) throw new Error(`Character ${id} not found`)
  // A picked scene that went stale while the dialog was open (renamed/unlinked
  // in another window) must ERROR, not silently wire the primary: the user asked
  // for a specific scene and would get a project that looks right and imports
  // the wrong export set. (buildHoudiniPrefill's own primary fallback stays, as
  // the pure-layer backstop for callers that pass nothing.)
  if (dazScenePath.trim()) {
    const wanted = dazScenePath.trim().replace(/\\/g, '/').toLowerCase()
    const linked = [character.scenePath, ...character.extraScenes].map((s) =>
      s.trim().replace(/\\/g, '/').toLowerCase(),
    )
    if (!linked.includes(wanted)) {
      throw new Error(
        `The picked Daz scene is not linked to this character anymore:\n${dazScenePath}\nReopen the dialog and pick again.`,
      )
    }
  }
  // `$JOB` is the CHARACTER folder (v0.64), not the shared project folder.
  // Measured with `hou.text.collapseCommonVars` — the call Houdini's file picker
  // uses to turn a chosen path back into a variable: a path ABOVE `$HIP`
  // collapses only when it sits under `$JOB`. With `$JOB` on
  // `houdini/houdini-project`, picking an export by hand produced an ABSOLUTE
  // path, so the project stopped being movable — a property the retired
  // `dth-exports` junction had been providing invisibly by making exports look
  // like they were below `$HIP`. With `$JOB` on the character folder the same
  // pick yields `$JOB/houdini/daz-export/…`, while `$HIP` still wins for paths
  // inside the houdini folder.
  //
  // Layout: the scene FILE lives in the character's houdini folder, which IS
  // the shared project folder — every one of a character's scenes sits there,
  // so they all share one `$HIP` and Houdini's own `$HIP`-relative output
  // (render/, geo/, backup/) collects in that single folder for free:
  //   <character>/                      ← $JOB (v0.64)
  //   houdini/<name>.hiplc              ← the scenes (one per generate)
  //   houdini/daz-export/<scene>/       ← what the imports READ
  //   houdini/render|geo|backup/        ← Houdini's own output, shared
  // A dedicated `houdini-project/` subfolder was created here until v0.68 and
  // could never attract any of that: `$HIP` is DERIVED from where the `.hip`
  // sits and cannot be pointed elsewhere (Set Project sets `$JOB`, not `$HIP`),
  // so the folder stayed empty while the output landed beside the scenes.
  // {@link sweepHoudiniProjectDirs} removes the empty leftovers.
  // The export root is a plain SIBLING of the scenes since the export-root move
  // (`$JOB/<houdiniSubdir>/daz-export/…` — the emitted swap is buildExportBlock
  // in @dth/rom dsa.ts, the prefix rule is `hipRefPrefixFor`). No junctions
  // anywhere since v0.63.
  const charFolder = location?.folderAbs ?? ''
  if (!charFolder) throw new Error(`Character ${id} not found`)
  const houdiniDir = characterHoudiniDir(charFolder, project.houdiniSubdir)
  const scenePath = generatedHoudiniScenePath(houdiniDir, sceneName)
  if (!scenePath) throw new Error('The project name cannot be empty.')
  if (await exists(scenePath)) {
    throw new Error(
      `A scene with that name already exists:\n${scenePath}\nPick a different name, or open the existing project instead.`,
    )
  }

  // The matching Houdini documents folder doubles as HOUDINI_USER_PREF_DIR
  // for hython — without it, hython inherits the studio's environment and can
  // resolve the prefs elsewhere, never loading the DazToHue otls (measured:
  // the same leak that hid the DazToHue shelf from studio-launched Houdini).
  // MATCHING by version is mandatory: prefs are per major.minor, so the
  // install `Houdini 22.0.x` must pair with a configured `houdini22.0` docs
  // folder (primary or extra) or hython would load another version's — or
  // no — otls.
  const houdiniPrefDir = matchingHoudiniDocsFolder(installDir, [
    settings.houdiniDocsFolder,
    ...settings.extraHoudiniDocsFolders,
  ])
  if (!houdiniPrefDir) {
    const version = houdiniVersionFromInstall(installDir)
    throw new Error(
      version
        ? `The Houdini installation (${version}) has no matching documents folder — add "…\\Documents\\houdini${version}" as a Houdini documents folder in Settings.`
        : `Could not read a Houdini version from the installation folder:\n${installDir}\nPoint it at a versioned install (e.g. "…\\Houdini 22.0.368").`,
    )
  }

  // Everything the studio already knows, prefilled onto the fresh network so
  // it comes out wired end-to-end: import/CSV/export paths (`$JOB/…` relative
  // when the project's path style allows — computed for THE hip being
  // generated, which by construction sits in the houdini folder — else
  // absolute), the character name (prefilled paths may bypass the HDA's
  // auto-fill) and the skinning the ROM targets.
  const scenesRootAbs = characterScenesRoot(character, location, project.dazSubdir ?? 'daz3d')
  const relative = project.houdiniPathStyle !== 'absolute'
  const hipRefPrefix = relative
    ? hipRefPrefixFor([scenePath], charFolder, character.exportPath)
    : ''
  // Houdini's OWN output goes to the character's `export/` folder — the end of
  // the pipeline, not the `daz-export` intermediates the imports read. Its
  // prefix is computed against that folder, so it comes out `$JOB/export`
  // rather than sharing the imports' `$JOB/houdini/daz-export`.
  const finalExportAbs = joinPath(charFolder, normalizeRelFolder(project.exportSubdir))
  const finalExportDir =
    (relative ? hipRefPrefixFor([scenePath], charFolder, finalExportAbs) : '') || finalExportAbs
  const prefill = buildHoudiniPrefill(character, {
    hipRefPrefix,
    scenesRootAbs,
    scenePath: dazScenePath,
    finalExportDir,
  })

  // zod-parsed, not a bare invoke<T>() cast (primitive
  // "<created>|<visible>|<prefilled>|<fps>" report — no fixture needed).
  const report = z.string().parse(
    await invoke('create_houdini_project', {
      request: {
        hythonPath,
        jobDir: charFolder,
        scenePath,
        houdiniPrefDir,
        prefillJson: JSON.stringify(prefill),
        // The timeline. DazToHue's import node sets this itself WHEN IT LOADS
        // THE FILES (mrpdean) — and a headless generation never loads one: the
        // network is instantiated and its parms set directly, so that trigger
        // cannot fire and the scene would save on Houdini's own 24 while the
        // ROM wired into it is 30.
        fps: DTH_FPS,
      },
    }),
  )
  const [created = 'none', visible = 'none', prefilledRaw = 'none', fpsRaw = 'none'] =
    report.split('|')
  return {
    scenePath,
    networkAdded: created !== 'none',
    visibleTypes: visible === 'none' ? [] : visible.split(',').filter(Boolean),
    prefilled: prefilledRaw === 'none' ? [] : prefilledRaw.split(',').filter(Boolean),
    // An older report (or a hython that could not answer) has no fourth field —
    // 0 reads as "unknown" everywhere, never as "wrong".
    fps: Number.parseFloat(fpsRaw) || 0,
  }
}

const removeInput = charScopeInput.extend({
  /** The linked `.hiplc` to remove (a generated one — it lives directly in
   *  the character's houdini/export folder). */
  hipPath: z.string().min(1),
})

/**
 * Delete a GENERATED Houdini project's SCENE FILE from disk. The remove
 * dialog's "Keep houdini files" toggle guards this; the caller unlinks the card
 * afterwards. Safety: the scene must live DIRECTLY in the character's Houdini
 * folder (the generated layout) — anything else refuses, so a hand-linked
 * project can never be deleted through this path.
 *
 * Only the `.hiplc` goes: the retired `houdini-project` folder (nothing
 * creates it since v0.68) is `sweepHoudiniProjectDirs`' job — swept when
 * empty, kept and reported when it holds real pre-v0.64 `$JOB` output.
 */
export async function removeGeneratedHoudiniProject({ data }: { data: unknown }): Promise<void> {
  const { projectId, id, hipPath } = removeInput.parse(data)
  if (!isTauri()) return
  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, id)
  if (!location) throw new Error(`Character ${id} not found`)
  const houdiniDir = characterHoudiniDir(location.folderAbs, project.houdiniSubdir)

  const norm = (p: string) => p.trim().replace(/\\/g, '/').toLowerCase()
  const hipNorm = norm(hipPath)
  const hipParent = hipNorm.slice(0, hipNorm.lastIndexOf('/'))
  if (hipParent !== norm(houdiniDir)) {
    throw new Error(
      'Only generated projects (living in the character’s houdini folder) can be deleted from here — unlink instead.',
    )
  }

  if (await exists(hipPath)) await remove(hipPath)
}

// --- "Export too": run a project's DazToHue exports after the Daz batch ------
//
// The studio half of the handoff whose Houdini side is `houdini-runtime/456.py`
// (contract + result parsing in ../houdini-jobs.ts). Deliberately the same
// shape as the Daz Runner: write a JSON job, launch, poll a result file the
// other side rewrites as it works. Everything about WHAT to export lives in
// 456.py; this side decides which scenes are in the job, starts Houdini with
// that job in its environment, and reads progress back.

const houdiniExportInput = charScopeInput.extend({
  /** The linked `.hip`/`.hiplc` to open and export from. */
  hipPath: z.string().min(1),
  /** The scenes whose networks should export — the same list the Daz batch just
   *  ran, so a project holding other characters' networks is left alone. */
  scenes: z.array(z.string().min(1)).min(1),
  /** What the CALLER is carrying that this layer can't know: the projects
   *  still queued behind this one, and the report accumulated so far. Recorded
   *  in the run sidecar so a reloaded window can finish the whole process —
   *  see {@link adoptHoudiniRun}. Absent = nothing queued, nothing to report
   *  yet (a Houdini-only run's first project). */
  remaining: z.array(z.string()).default([]),
  reportLines: z.array(z.string()).default([]),
  anyFailed: z.boolean().default(false),
  /** Linked `.uproject`s to hand the finished export to, once the WHOLE queue
   *  is done. Carried here for the same reason as the queue itself: the send
   *  happens minutes later, in a window that may have reloaded since. */
  unrealProjects: z.array(z.string()).default([]),
  /** The export sets to hand over (the user's tick list). */
  unrealSets: z.array(z.string()).default([]),
})

/**
 * The in-flight Houdini run, in memory for this window only — the same scoping
 * the Daz batch uses. All live state is in the result file, written by 456.py;
 * this holds only the identity of the run the poll belongs to.
 */
interface ActiveHoudiniRun {
  characterId: string
  /** Absolute path of the job file handed to 456.py — kept so the run can
   *  clear it when it ends (see `houdiniRunFilesToClear`). */
  jobPath: string
  /** Absolute path of the result file 456.py writes. */
  resultPath: string
  /** Scenes that went into the job — the count shown until 456.py reports its
   *  own node total (one scene may hold several export nodes, or none). */
  scenes: number
  /** When the handoff was armed (`Date.now()`) — the elapsed clock's zero and
   *  the finish toast's total. In-memory, like the Daz watch's twin. */
  startedAtMs: number
}
let activeHoudiniRun: ActiveHoudiniRun | null = null

/**
 * The Houdini leg's run-plan sidecar — the twin of the Daz leg's
 * `export-run.json`, and for the same reason: this watch is MEMORY. A window
 * that reloads while hython works loses the watch, the queue of projects still
 * to come and the accumulated report, and the leg is headless now, so nothing
 * on screen says so — the export finishes inside Houdini and the studio never
 * reports it, while every project behind it silently never starts.
 *
 * Unlike the Daz twin it lives in the CHARACTER folder, not app-data (see
 * {@link runPlanPath}). Written when a project's run is armed and whenever the
 * queue advances, deleted when the whole process ends. Restored by
 * {@link adoptHoudiniRun}, which re-arms the watch from the paths recorded here.
 *
 * Being a character-folder file, it is machine-local run state sitting in a
 * folder the user backs up and can zip — so it joins the job/result files in
 * `characterZipExclusions`. The NAME lives in `houdini-jobs.ts` with its
 * siblings, so that exclusion list can never fall behind this one.
 */

const houdiniRunPlanSchema = z.object({
  characterId: z.string().min(1),
  /** The project being exported right now (its `.hip`). */
  hipPath: z.string().min(1),
  jobPath: z.string().min(1),
  resultPath: z.string().min(1),
  scenes: z.number().int().nonnegative(),
  startedAtMs: z.number(),
  /** Projects still waiting their turn, in order. */
  remaining: z.array(z.string()).default([]),
  /** The scene scope every project of this run exports. */
  sceneScope: z.array(z.string()).default([]),
  /** The report so far — the Daz leg's line and each finished project's, so a
   *  restored window can still deliver ONE end-of-everything report. */
  reportLines: z.array(z.string()).default([]),
  /** Whether any leg so far failed — the report's tone. */
  anyFailed: z.boolean().default(false),
  /** The Unreal projects this run finishes into (see the input's own field). */
  unrealProjects: z.array(z.string()).default([]),
  unrealSets: z.array(z.string()).default([]),
})

export type HoudiniRunPlan = z.infer<typeof houdiniRunPlanSchema>

/** The plan lives BESIDE the job/result files, in the character's own folder:
 *  those are per character, and so is a run — an app-data singleton would let
 *  a second character's Houdini leg overwrite the first's plan. */
function runPlanPath(charFolderAbs: string): string {
  return joinPath(charFolderAbs, HOUDINI_RUN_FILE)
}

/**
 * Every plan write/delete queues on ONE chain, so they land in call order —
 * the same guard the Daz sidecar's `queueSidecar` earned. {@link
 * dismissHoudiniRun} schedules its delete from a synchronous UI handler, so
 * without this a Ctrl-stop's clear could still be in flight when the user
 * starts the next Houdini run, and would then delete the NEW run's plan —
 * silently costing that run the reload survival this whole feature is.
 * Serialising makes "last call wins" true.
 */
let planChain: Promise<void> = Promise.resolve()
function queuePlan(op: () => Promise<void>): Promise<void> {
  planChain = planChain.then(op, op)
  return planChain
}

/** Best-effort — a failed write only costs a later reload its restore. */
export function saveHoudiniRunPlan(charFolderAbs: string, plan: HoudiniRunPlan): Promise<void> {
  return queuePlan(async () => {
    if (!charFolderAbs) return
    try {
      await storage.writeTextFileAtomic(runPlanPath(charFolderAbs), JSON.stringify(plan))
    } catch {
      // best effort
    }
  })
}

function clearHoudiniRunPlan(charFolderAbs: string): Promise<void> {
  return queuePlan(async () => {
    // An empty folder would resolve the plan path relative to the process —
    // never write or delete on a guess.
    if (!charFolderAbs) return
    try {
      const path = runPlanPath(charFolderAbs)
      if (await exists(path)) await remove(path)
    } catch {
      // best effort — the next run overwrites it either way
    }
  })
}

async function readHoudiniRunPlan(charFolderAbs: string): Promise<HoudiniRunPlan | null> {
  try {
    // Reads join the same queue as the writes: an adopt that lands right after
    // a Ctrl-stop must see the CLEARED plan, or it would restore the very run
    // the user just stopped watching — queue and all.
    await planChain
    const path = runPlanPath(charFolderAbs)
    if (!(await exists(path))) return null
    return houdiniRunPlanSchema.parse(JSON.parse(await readTextFile(path)))
  } catch {
    return null
  }
}

/**
 * Re-arm the Houdini watch from the sidecar after a reload — the character's
 * OWN editor only (`characterId` must match), so a foreign window can never
 * adopt ownership of a report or of the project queue.
 *
 * Returns the plan when a run was restored, null when there is nothing to
 * restore. Deliberately does NOT check whether Houdini is alive: the watch's
 * own poll does that one poll later and reports a dead run properly (with the
 * queue dropped and a sticky toast), which is a better answer than silence.
 * A stale sidecar whose result file is gone is cleared instead of adopted.
 *
 * An ALREADY-ARMED module watch for this same character does not block the
 * restore, it just isn't re-armed. Only the caller's component state decides
 * whether anything is on screen, and this function is called from a fresh
 * mount — so "the module is watching" there means the COMPONENT lost its state
 * while the module kept the watch. Two ways in: a reload, and an adopt whose
 * window navigated away between the arm and the `.then` (which discards the
 * plan but not the watch). Bailing on that combination left the leg invisible
 * with no way back short of restarting the app — the exact failure this
 * function exists to prevent, made permanent. A watch belonging to ANOTHER
 * character is not ours to touch.
 */
export async function adoptHoudiniRun({ data }: { data: unknown }): Promise<HoudiniRunPlan | null> {
  const { projectId, id } = charScopeInput.parse(data)
  if (!isTauri()) return null
  if (activeHoudiniRun && activeHoudiniRun.characterId !== id) return null
  let charFolderAbs = ''
  try {
    const project = await resolveProject(projectId)
    const location = await locateCharacter(charsRoot(project), id)
    if (!location) return null
    charFolderAbs = location.folderAbs
  } catch {
    return null
  }
  const plan = await readHoudiniRunPlan(charFolderAbs)
  if (!plan || plan.characterId !== id) return null
  try {
    if (!(await exists(plan.resultPath)) && !(await exists(plan.jobPath))) {
      // Neither file left: the run ended while nobody watched (its owner
      // cleaned up, or a later run swept them). Nothing to adopt.
      await clearHoudiniRunPlan(charFolderAbs)
      return null
    }
  } catch {
    return null
  }
  // A live watch for this character stays as it is — it is the authority on
  // WHICH project is running (the queue may have advanced since this plan was
  // written). The plan is still returned, so the fresh component rebuilds its
  // cards, queue and report from it.
  activeHoudiniRun ??= {
    characterId: plan.characterId,
    jobPath: plan.jobPath,
    resultPath: plan.resultPath,
    scenes: plan.scenes,
    startedAtMs: plan.startedAtMs,
  }
  return plan
}

/** What arming a run reports back to the dialog. */
export interface HoudiniExportStarted {
  /** Absolute path of the job file written. */
  jobFile: string
  /** Scenes that made it into the job (one `.dth` each). */
  scenes: number
}

/**
 * Write the job, drop the runner scripts where hython will find them, and
 * start the export HEADLESS — `hython headless_export.py` loads the project
 * and works the job; no Houdini window (flipped from the GUI launch
 * 2026-08-11: the live progress chip replaced "watching it happen", headless
 * kills the window/paint fragility class, and the full console — C++ cook
 * chatter included — lands in a per-run log the in-process tee could never
 * see). "Open only" still opens the visible GUI, through `openScene`.
 *
 * The scripts are rewritten on EVERY run rather than installed once: they are
 * small, must track the app version, and a self-repairing copy needs no marker
 * file and no "reinstall the runtime" ritual (unlike the Daz runtime, which
 * the user also runs by hand from the Content Library).
 *
 * Throws with a user-facing message when a precondition fails: not the desktop
 * app, no Houdini install or matching prefs folder configured, the project not
 * linked to this character, or no scene resolving to a `.dth` — nothing a
 * network could have imported.
 */
export async function startHoudiniExport({
  data,
}: {
  data: unknown
}): Promise<HoudiniExportStarted> {
  const { projectId, id, hipPath, scenes, remaining, reportLines, anyFailed, unrealProjects, unrealSets } =
    houdiniExportInput.parse(data)
  if (!isTauri()) throw new Error('Export too needs the desktop app (it launches Houdini).')

  const settings = await storage.getSettings()
  const installDir = settings.houdiniInstallFolder.trim()
  if (!installDir) {
    throw new Error('Set the Houdini installation folder in Settings first — Export too runs Houdini in the background.')
  }
  const hythonPath = joinPath(installDir.replace(/\\/g, '/'), 'bin/hython.exe')
  if (!(await exists(hythonPath))) {
    throw new Error(`hython was not found:\n${hythonPath}\nCheck the Houdini installation folder in Settings.`)
  }
  // The same version-matched prefs Generate project needs: without them Houdini
  // can resolve another version's (or no) otls, and the DazToHue export nodes
  // this job drives would not exist in the session we just started.
  const houdiniPrefDir = matchingHoudiniDocsFolder(installDir, [
    settings.houdiniDocsFolder,
    ...settings.extraHoudiniDocsFolders,
  ])
  if (!houdiniPrefDir) {
    const version = houdiniVersionFromInstall(installDir)
    throw new Error(
      version
        ? `The Houdini installation (${version}) has no matching documents folder — add "…\\Documents\\houdini${version}" as a Houdini documents folder in Settings.`
        : `Could not read a Houdini version from the installation folder:\n${installDir}\nPoint it at a versioned install (e.g. "…\\Houdini 22.0.368").`,
    )
  }

  const project = await resolveProject(projectId)
  const lib = charsRoot(project)
  const location = await locateCharacter(lib, id)
  const character = location ? await storage.getCharacter(lib, id, location.definitionAbs) : null
  if (!location || !character) throw new Error(`Character ${id} not found`)

  const norm = (p: string) => p.trim().replace(/\\/g, '/').toLowerCase()
  // Still one of the character's linked projects? The dialog only offers those;
  // this is the backstop against a pick that went stale while it was open.
  const linkedHip = character.houdiniProjects.find((p) => norm(p) === norm(hipPath))
  if (!linkedHip) {
    throw new Error(`The Houdini project is not linked to this character anymore:\n${hipPath}`)
  }
  if (!(await exists(linkedHip))) {
    throw new Error(`The Houdini project file is missing:\n${linkedHip}`)
  }

  const jobFile = joinPath(location.folderAbs, HOUDINI_JOB_FILE)
  const resultPath = joinPath(location.folderAbs, HOUDINI_RESULT_FILE)
  const scenesRootAbs = characterScenesRoot(character, location, project.dazSubdir ?? 'daz3d')
  const job = buildHoudiniJob(character, scenes, {
    resultPath,
    // A FALLBACK only: 456.py fills a node's blank export_directory with this
    // and restores whatever the user had set (their project, their choice).
    // The character's FINAL export folder — where Houdini WRITES for Unreal —
    // never `character.exportPath`, which is the regenerable `daz-export`
    // intermediate the imports READ (the same wrong target Generate project
    // used to bake; see buildHoudiniPrefill's exportDirectory note).
    exportDirectory: joinPath(location.folderAbs, normalizeRelFolder(project.exportSubdir)),
    scenesRootAbs,
    // This Houdini instance exists to carry the batch — 456.py closes it again
    // after the final result lands ("Open only" never reaches this code path).
    closeWhenDone: true,
  })
  if (job.scenes.length === 0) {
    throw new Error(
      'None of these scenes has an export path, so no Houdini network could have imported them — export from Daz first.',
    )
  }

  // A result file from an earlier run would be read as this run's progress
  // before 456.py has written its own. The studio owns that cleanup.
  try {
    if (await exists(resultPath)) await remove(resultPath)
  } catch {
    // locked — houdiniRunStateFrom tolerates the stale read until it is rewritten
  }

  // Both runner scripts into app-data. Deliberately NOT on HOUDINI_SCRIPT_PATH:
  // Houdini runs a 456.py found there on the startup EMPTY scene too (measured
  // 2026-08-11, the first headless run — the job was consumed against the empty
  // scene and hython exited before the project ever loaded). The bootstrap
  // execs 456.py itself, exactly once, after the load.
  const scriptsDir = await storage.dataPath(HOUDINI_SCRIPTS_FOLDER)
  await mkdir(scriptsDir, { recursive: true })
  await storage.writeTextFileAtomic(joinPath(scriptsDir, '456.py'), houdiniRunnerScript)
  await storage.writeTextFileAtomic(
    joinPath(scriptsDir, HOUDINI_HEADLESS_RUNNER),
    houdiniHeadlessRunner,
  )
  await storage.writeTextFileAtomic(jobFile, JSON.stringify(job, null, 2))

  const consolePath = joinPath(location.folderAbs, HOUDINI_CONSOLE_FILE)
  await invoke('launch_houdini_job', {
    request: {
      hythonPath,
      runnerPath: joinPath(scriptsDir, HOUDINI_HEADLESS_RUNNER),
      scenePath: linkedHip,
      jobPath: jobFile,
      houdiniPrefDir,
      logPath: consolePath,
    },
  })

  activeHoudiniRun = {
    characterId: character.id,
    jobPath: jobFile,
    resultPath,
    scenes: job.scenes.length,
    startedAtMs: Date.now(),
  }
  // Mirror the run to disk so a reload can pick the watch back up. The queue
  // and the report ride along from the caller (it owns them); this call
  // records what only THIS layer knows — the paths and the start.
  await saveHoudiniRunPlan(location.folderAbs, {
    characterId: character.id,
    hipPath: linkedHip,
    jobPath: jobFile,
    resultPath,
    scenes: job.scenes.length,
    startedAtMs: activeHoudiniRun.startedAtMs,
    remaining,
    sceneScope: scenes,
    reportLines,
    anyFailed,
    unrealProjects,
    unrealSets,
  })
  return { jobFile, scenes: job.scenes.length }
}

/** The character folder a run's files live in — the job file's own directory,
 *  which is where the studio wrote all three (job, result, plan). */
function runFolderOf(run: ActiveHoudiniRun): string {
  const slash = run.jobPath.replace(/\\/g, '/').lastIndexOf('/')
  return slash > 0 ? run.jobPath.replace(/\\/g, '/').slice(0, slash) : ''
}

/** The active Houdini run's state (null when none is armed) — mirrors
 *  `fetchExportRunProgress`: a torn read reports "still starting" and the next
 *  poll gets a clean one, and a finished or dead run clears the watch so the
 *  caller reports the outcome exactly once. */
export async function fetchHoudiniRunProgress(): Promise<
  (HoudiniRunState & { characterId: string; scenes: number }) | null
> {
  const run = activeHoudiniRun
  if (!run) return null
  let result: HoudiniResult | null = null
  try {
    if (await exists(run.resultPath)) result = parseHoudiniResult(await readTextFile(run.resultPath))
  } catch {
    // transient fs error, or the write-then-rename mid-flight — treat it as
    // "no file yet" and let the liveness check decide whether to keep waiting
    result = null
  }
  // A primitive return — z.boolean, not a bare invoke<T>() cast (no fixture
  // needed); a parse failure reads as "can't tell" = keep waiting, like an
  // invoke failure always has.
  const houdiniUp = await invoke('houdini_running')
    .then((up) => z.boolean().parse(up))
    .catch(() => true)
  // Only when the run looks DEAD is the console log worth a read: it is the
  // one case where the studio has an answer on disk and nothing else does.
  // (Reading it on every poll would re-read a growing file every 2.5 s.) The
  // condition is the pure module's own, not a second copy of it.
  let consoleText = ''
  if (houdiniRunLooksDead(result, houdiniUp)) {
    const consolePath = joinPath(runFolderOf(run), HOUDINI_CONSOLE_FILE)
    try {
      if (await exists(consolePath)) consoleText = await readTextFile(consolePath)
    } catch {
      // unreadable — the caller falls back to the plain "no longer running"
    }
  }
  const state = houdiniRunStateFrom(result, houdiniUp, consoleText)
  if (state.state === 'finished' || state.state === 'dead') {
    if (activeHoudiniRun === run) activeHoudiniRun = null
    // The plan dies with the run it describes. A queue that continues writes a
    // fresh one when its next project arms — and that happens strictly AFTER
    // this await returns, so the clear can never eat the successor's plan.
    await clearHoudiniRunPlan(runFolderOf(run))
    // The run is over and this snapshot carries everything the caller reports
    // (counts, summary, the HDA's problems) — so the handoff's own files go
    // now instead of sitting in the character folder until some later run
    // happens to overwrite them. Which files, and when, is the pure rule.
    for (const path of houdiniRunFilesToClear({
      state: state.state,
      hasResult: result !== null,
      jobPath: run.jobPath,
      resultPath: run.resultPath,
    })) {
      try {
        if (await exists(path)) await remove(path)
      } catch {
        // locked (scanner, an editor holding it) — the next run's start-of-run
        // cleanup clears the result, and rewrites the job, either way
      }
    }
  }
  // The timing rides the in-memory watch, not the result file: the elapsed
  // clock for starting/running, the total for the finish toast.
  if (state.state === 'finished') {
    return {
      ...state,
      elapsedMs: Date.now() - run.startedAtMs,
      characterId: run.characterId,
      scenes: run.scenes,
    }
  }
  if (state.state === 'starting' || state.state === 'running') {
    return { ...state, startedAtMs: run.startedAtMs, characterId: run.characterId, scenes: run.scenes }
  }
  return { ...state, characterId: run.characterId, scenes: run.scenes }
}

/**
 * Stop watching the Houdini run. Houdini itself is unaffected — the watch is
 * an observer only, and the export it started keeps going.
 *
 * The in-memory half is synchronous; the returned promise is the PLAN delete,
 * for a caller that needs it to have landed (tests do). UI callers ignore it —
 * ordering against a run started straight afterwards is the chain's job either
 * way (see {@link queuePlan}).
 */
export function dismissHoudiniRun(): Promise<void> {
  const run = activeHoudiniRun
  activeHoudiniRun = null
  // The plan goes with the watch: leaving it would let the next reload adopt a
  // run the user deliberately stopped watching (queue and all).
  return run ? clearHoudiniRunPlan(runFolderOf(run)) : Promise.resolve()
}

/**
 * Each linked scene's expected `.dth` path, keyed by {@link normalizeSceneKey}
 * — the identity a DazToHue network carries, and what the DTH Export dialog
 * matches a project's recorded `imports` against.
 *
 * Lives HERE, not in the dialog, for one measured reason: the export folder of
 * a scene inside a subfolder (`daz3d/primary/…`) is that subfolder, and
 * deriving it needs the character's scenes ROOT — which needs the project's
 * `dazSubdir`, i.e. the resolution this layer does and a component cannot.
 * Computed in the dialog without it, every scene fell back to its file STEM
 * (`.../daz-export/LaraCroft_G8_1_SLIM/…`) and matched no real import
 * (`.../daz-export/primary/…`), so the auto-selection quietly never fired.
 * The SAME `buildHoudiniJob` uses, so the dialog and the run agree by
 * construction.
 */
export async function fetchSceneDthPaths({
  data,
}: {
  data: unknown
}): Promise<Record<string, string>> {
  const { projectId, id } = charScopeInput.parse(data)
  if (!isTauri()) return {}
  try {
    const project = await resolveProject(projectId)
    const lib = charsRoot(project)
    const location = await locateCharacter(lib, id)
    const character = location ? await storage.getCharacter(lib, id, location.definitionAbs) : null
    if (!location || !character) return {}
    const scenesRootAbs = characterScenesRoot(character, location, project.dazSubdir ?? 'daz3d')
    const paths: Record<string, string> = {}
    for (const scene of [character.scenePath, ...character.extraScenes]) {
      if (!scene) continue
      const dth = sceneDthPath(character, scene, scenesRootAbs)
      if (dth) paths[normalizeSceneKey(scene)] = dth
    }
    return paths
  } catch {
    // Read-only convenience: without it the dialog simply doesn't auto-adjust.
    return {}
  }
}
