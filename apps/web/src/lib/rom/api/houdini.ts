import { copyFile, exists, mkdir, readTextFile, remove } from '@tauri-apps/plugin-fs'
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
  HOUDINI_JOB_FILE,
  HOUDINI_RESULT_FILE,
  HOUDINI_SCRIPTS_FOLDER,
  buildHoudiniJob,
  buildHoudiniPrefill,
  houdiniRunFilesToClear,
  houdiniRunStateFrom,
  houdiniScriptPathValue,
  parseHoudiniResult,
} from '../houdini-jobs'
import type { HoudiniResult, HoudiniRunState } from '../houdini-jobs'
import type { Character } from '@dth/rom'
// Houdini's half of the handoff, bundled as source and written into app-data
// before each launch (see startHoudiniExport).
import houdiniRunnerScript from '../houdini-runtime/456.py?raw'
import { characterScenesRoot } from './execute'
import { normalizeRelFolder } from '../library'
import { normalizePathLower } from '#/lib/path.ts'
import { charScopeInput, charsRoot, joinPath, locateCharacter, resolveProject } from './core'

// "Generate project": create a ready-made DazToHue Houdini project for a
// character. hython starts a fresh scene, bakes $JOB to the character's ONE
// shared `houdini-project` folder, creates the DazToHue network FROM THE USER'S
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
 * (`Repair $JOB`, `Make paths portable`, `Fill network`). So the copy is offered,
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
  // "<created>|<visible>|<prefilled>" report — no fixture needed).
  const report = z.string().parse(
    await invoke('create_houdini_project', {
      request: {
        hythonPath,
        jobDir: charFolder,
        scenePath,
        houdiniPrefDir,
        prefillJson: JSON.stringify(prefill),
      },
    }),
  )
  const [created = 'none', visible = 'none', prefilledRaw = 'none'] = report.split('|')
  return {
    scenePath,
    networkAdded: created !== 'none',
    visibleTypes: visible === 'none' ? [] : visible.split(',').filter(Boolean),
    prefilled: prefilledRaw === 'none' ? [] : prefilledRaw.split(',').filter(Boolean),
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

/** What arming a run reports back to the dialog. */
export interface HoudiniExportStarted {
  /** Absolute path of the job file written. */
  jobFile: string
  /** Scenes that made it into the job (one `.dth` each). */
  scenes: number
}

/**
 * Write the job, drop `456.py` where Houdini will find it, and open the project.
 *
 * The script is rewritten on EVERY run rather than installed once: it is small,
 * it must track the app version, and a self-repairing copy needs no marker file
 * and no "reinstall the runtime" ritual (unlike the Daz runtime, which the user
 * also runs by hand from the Content Library).
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
  const { projectId, id, hipPath, scenes } = houdiniExportInput.parse(data)
  if (!isTauri()) throw new Error('Export too needs the desktop app (it launches Houdini).')

  const settings = await storage.getSettings()
  const installDir = settings.houdiniInstallFolder.trim()
  if (!installDir) {
    throw new Error('Set the Houdini installation folder in Settings first — Export too launches Houdini.')
  }
  const houdiniPath = joinPath(installDir.replace(/\\/g, '/'), 'bin/houdini.exe')
  if (!(await exists(houdiniPath))) {
    throw new Error(`Houdini was not found:\n${houdiniPath}\nCheck the Houdini installation folder in Settings.`)
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

  // 456.py into app-data, and HOUDINI_SCRIPT_PATH pointed at that folder.
  const scriptsDir = await storage.dataPath(HOUDINI_SCRIPTS_FOLDER)
  await mkdir(scriptsDir, { recursive: true })
  await storage.writeTextFileAtomic(joinPath(scriptsDir, '456.py'), houdiniRunnerScript)
  await storage.writeTextFileAtomic(jobFile, JSON.stringify(job, null, 2))

  await invoke('launch_houdini_job', {
    request: {
      houdiniPath,
      scenePath: linkedHip,
      jobPath: jobFile,
      scriptPath: houdiniScriptPathValue(scriptsDir),
      houdiniPrefDir,
    },
  })

  activeHoudiniRun = {
    characterId: character.id,
    jobPath: jobFile,
    resultPath,
    scenes: job.scenes.length,
    startedAtMs: Date.now(),
  }
  return { jobFile, scenes: job.scenes.length }
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
  const state = houdiniRunStateFrom(result, houdiniUp)
  if (state.state === 'finished' || state.state === 'dead') {
    if (activeHoudiniRun === run) activeHoudiniRun = null
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

/** Stop watching the Houdini run. Houdini itself is unaffected — the watch is
 *  an observer only, and the export it started keeps going. */
export function dismissHoudiniRun(): void {
  activeHoudiniRun = null
}
