import { exists, mkdir, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { z } from 'zod'

import * as storage from '../storage'
import { houdiniVersionFromInstall, matchingHoudiniDocsFolder } from '#/lib/houdini-version.ts'
import {
  EXPORTS_FOLDER,
  characterHoudiniDir,
  characterHoudiniProjectDir,
  hipAnchorDirs,
} from '#/lib/scene-subfolder.ts'
import {
  HOUDINI_JOB_FILE,
  HOUDINI_RESULT_FILE,
  HOUDINI_SCRIPTS_FOLDER,
  buildHoudiniJob,
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
// The project folder holds no exports (schema v29) — those live in the
// character's fixed Daz-side export root. It gets a `dth-exports` JUNCTION
// pointing there instead, so Houdini's file picker (which opens at $JOB) shows
// the exports one click away rather than two levels up. That one is a pure
// shortcut; its twin BESIDE each `.hip` is load-bearing for `$HIP`-relative
// reference paths — see linkExportsIntoProject / refreshExportJunctions below.

const generateInput = charScopeInput.extend({
  /** The new scene's name (dialog input, prefilled `<Project>_<Character>`). */
  sceneName: z.string().min(1),
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
 * Put a `dth-exports` junction into `projectDir`, pointing at the character's
 * real export root. Returns whether the link is in place. ONE mechanism with
 * TWO roles, depending on where the junction goes:
 *
 * - In the shared `houdini-project/` folder ($JOB) it is a pure file-picker
 *   shortcut — Houdini's picker opens at $JOB, so the exports sit one click
 *   away instead of two levels up in the Daz subfolder. Nothing resolves
 *   through this one; a failure costs the shortcut and nothing else.
 * - Beside a linked `.hip` (the {@link hipAnchorDirs} set) it is LOAD-BEARING:
 *   `$HIP/dth-exports/...` reference-skeleton paths in the delivered PoseAsset
 *   CSV resolve through it. That is why {@link refreshExportJunctions} probes
 *   these at generation time and the emit falls back to absolute paths when
 *   one cannot be created — a failure here may never ship a broken ref.
 *
 * Failure modes for both: a non-NTFS or network export root (a junction can't
 * target UNC), a real folder already sitting at that name, a version-control
 * client that deleted it. Idempotent and self-repairing (`create_junction`
 * repoints a stale link and reports `"exists"` for a correct one), so every
 * generation — and every Generate project — repairs them.
 */
async function linkExportsIntoProject(projectDir: string, exportPath: string): Promise<boolean> {
  const target = exportPath.trim().replace(/\\/g, '/')
  if (!target || !isTauri()) return false
  try {
    // A primitive return — z.enum, not a bare invoke<T>() cast (no fixture
    // needed; see the FFI ritual in .ai/conventions.md).
    z.enum(['created', 'exists']).parse(
      await invoke('create_junction', {
        request: { linkPath: joinPath(projectDir, EXPORTS_FOLDER), targetPath: target },
      }),
    )
    return true
  } catch {
    return false
  }
}

/**
 * Ensure a `dth-exports` junction exists beside every linked `.hip` inside the
 * character folder — the {@link hipAnchorDirs} set, the EXACT places a
 * `$HIP/dth-exports/...` reference-skeleton path can resolve through — plus
 * the file-picker shortcut in the shared `houdini-project/` folder. TWO jobs
 * from the ONE funnel every generation path already goes through
 * (`generateCharacterFiles`):
 *
 * - **The `$HIP` emit decision.** `hipRelativeRefs` reaches the pure core only
 *   when this returns true — every anchor has its junction — so a delivered
 *   CSV can never carry a `$HIP` path with nothing behind it. The probe IS the
 *   repair (`create_junction` is idempotent: `"exists"` for a correct link, a
 *   stale one repointed), so pre-existing projects gain their junction on the
 *   next generation, and any failure — a network/non-NTFS export root, a real
 *   folder in the way — makes that character fall back to absolute paths
 *   instead of silently shipping refs that cannot resolve.
 * - **Junction upkeep.** The junctions store an ABSOLUTE target, so anything
 *   that changes the export root leaves them aiming at the old one — a
 *   character rename or folder move, a scenes-folder rename (the export root
 *   lives inside it), a `charactersSubdir` move, the v29 export-root
 *   migration. Rather than teach each of those about Houdini, the one refresh
 *   here re-points them all on the next save. The picker link refreshes only
 *   while its `houdini-project/` folder already exists (Generate project
 *   creates it; materializing it for a character that never generated a
 *   project would be noise) and never affects the return value — nothing
 *   resolves through it.
 *
 * Returns false when there is nothing to anchor (no linked `.hip` inside the
 * character folder, or no export root). In a browser there is no filesystem to
 * probe, so having anchors at all is the best available answer.
 */
export async function refreshExportJunctions(
  character: Character,
  charFolderAbs: string,
  houdiniSubdir?: string,
): Promise<boolean> {
  const anchors = hipAnchorDirs(character.houdiniProjects, charFolderAbs)
  const target = character.exportPath.trim()
  if (!target || !charFolderAbs) return false
  if (!isTauri()) return anchors.length > 0
  // The $JOB picker shortcut rides along — refreshed whenever its folder is
  // there, independent of the anchors (the folder outlives an unlinked hip;
  // see removeGeneratedHoudiniProject).
  const projectDir = characterHoudiniProjectDir(charFolderAbs, houdiniSubdir)
  if (await exists(projectDir).catch(() => false)) {
    await linkExportsIntoProject(projectDir, target)
  }
  if (anchors.length === 0) return false
  const linked = await Promise.all(anchors.map((dir) => linkExportsIntoProject(dir, target)))
  return linked.every(Boolean)
}

export interface GeneratedHoudiniProject {
  /** Absolute path of the saved `.hiplc` — the caller links it. */
  scenePath: string
  /** The project folder `$JOB` was baked to (shared by the character's
   *  projects — this generate may have reused an existing one). */
  projectDir: string
  /** Whether the `dth-exports` junction into the export root is in place —
   *  false just means the file-picker shortcut is missing (see
   *  `linkExportsIntoProject`), never that the project is broken. The
   *  load-bearing junction BESIDE the `.hip` is not reported here: generation
   *  probes it itself ({@link refreshExportJunctions}) and falls back to
   *  absolute reference paths when it is missing. */
  exportsLink: boolean
  /** Whether the DazToHue network was created from the installed HDA (false =
   *  hython couldn't see the HDA — the scene saved empty, `$JOB` still baked;
   *  the user adds the network from the DazToHue shelf). */
  networkAdded: boolean
  /** Every DazToHue-ish node type hython could see (`<category>/<type>`) —
   *  diagnosis when `networkAdded` is false: empty means the otls didn't load
   *  at all; SOP-only entries mean the main asset isn't an Object-level HDA. */
  visibleTypes: Array<string>
}

export async function generateHoudiniProject({
  data,
}: {
  data: unknown
}): Promise<GeneratedHoudiniProject> {
  const { projectId, id, sceneName } = generateInput.parse(data)
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
  if (!character) throw new Error(`Character ${id} not found`)
  // Layout: the scene FILE lives in the character's houdini folder, NEXT TO the
  // one shared project folder every one of its scenes Set-Projects into:
  //   houdini/<name>.hiplc              ← the scene (one per generate)
  //   houdini/dth-exports               → junction to the export root — THE
  //                                       anchor $HIP-relative reference paths
  //                                       resolve through (the emit decision is
  //                                       refreshExportJunctions above; the
  //                                       emitted swap is buildExportBlock in
  //                                       @dth/rom dsa.ts)
  //   houdini/houdini-project/          ← $JOB, shared — created once
  //   houdini/houdini-project/dth-exports  → junction to the export root
  //
  // TWO junctions to the same target, with different jobs: the one in the
  // project folder is the file-picker shortcut ($JOB), the one beside the .hip
  // is what `$HIP/dth-exports/...` in a generated CSV resolves through. The
  // second is load-bearing, which is why generation re-probes it every time
  // (refreshExportJunctions) and falls back to absolute reference paths while
  // it cannot exist.
  const charFolder = location?.folderAbs ?? ''
  if (!charFolder) throw new Error(`Character ${id} not found`)
  const houdiniDir = characterHoudiniDir(charFolder, project.houdiniSubdir)
  const projectDir = characterHoudiniProjectDir(charFolder, project.houdiniSubdir)
  const scenePath = generatedHoudiniScenePath(houdiniDir, sceneName)
  if (!scenePath) throw new Error('The project name cannot be empty.')
  if (await exists(scenePath)) {
    throw new Error(
      `A scene with that name already exists:\n${scenePath}\nPick a different name, or open the existing project instead.`,
    )
  }

  // Created by whichever generate runs first; every later one finds it and
  // reuses it, so all of a character's projects share one $JOB.
  await mkdir(projectDir, { recursive: true })
  const exportsLink = project.createExportJunctions
    ? await linkExportsIntoProject(projectDir, character.exportPath)
    : false
  // The $HIP-side twin: `$HIP` is the folder the .hip sits in, so a CSV path
  // written as `$HIP/dth-exports/...` resolves through THIS one. Seeded here
  // because the new .hip isn't linked to the character yet (the caller links
  // it after), so the generation-time refresh can't know about it until then.
  await linkExportsIntoProject(houdiniDir, character.exportPath)

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

  // zod-parsed, not a bare invoke<T>() cast (primitive "<created>|<visible>"
  // report — no fixture needed).
  const report = z.string().parse(
    await invoke('create_houdini_project', {
      request: { hythonPath, projectDir, scenePath, houdiniPrefDir },
    }),
  )
  const [created = 'none', visible = 'none'] = report.split('|')
  return {
    scenePath,
    projectDir,
    exportsLink,
    networkAdded: created !== 'none',
    visibleTypes: visible === 'none' ? [] : visible.split(',').filter(Boolean),
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
 * The `houdini-project` folder is deliberately NOT touched: it is shared by
 * every one of the character's projects now (schema v29), so deleting it with
 * one project would break the others' `$JOB`. It holds no exports either — just
 * the `dth-exports` junction and whatever Houdini itself writes — so leaving it
 * costs nothing, and the next Generate project reuses it.
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
    exportDirectory: character.exportPath,
    scenesRootAbs,
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
  const houdiniUp = await invoke<boolean>('houdini_running').catch(() => true)
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
  return { ...state, characterId: run.characterId, scenes: run.scenes }
}

/** Stop watching the Houdini run. Houdini itself is unaffected — the watch is
 *  an observer only, and the export it started keeps going. */
export function dismissHoudiniRun(): void {
  activeHoudiniRun = null
}
