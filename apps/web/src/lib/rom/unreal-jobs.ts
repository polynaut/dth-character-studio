import { z } from 'zod'

/**
 * The Unreal import handoff — the studio's third job-file contract, and
 * deliberately the same shape as the other two.
 *
 * Daz gets `dth_exporter_jobs.json` claimed by the Runner; Houdini gets
 * `.dth_houdini_job.json` claimed by 456.py; Unreal gets `job.json` claimed by
 * the studio's own Runner plugin (`unreal-runtime/dth_runner.py`). Same three
 * moves each time: write a job, the other side renames it to claim it, the
 * studio polls a result file.
 *
 * Everything here is PURE — the paths, the file contents and the state rule —
 * so the whole protocol is testable without an Unreal on the machine, which
 * matters more here than anywhere else: an editor takes minutes to start.
 */

/** Under the Unreal project's own `Saved/` — scratch space by Unreal's own
 *  convention, never `Content/`, so nothing the studio writes can be mistaken
 *  for an asset. */
export const UNREAL_JOB_FOLDER = 'Saved/DTHStudio'
export const UNREAL_JOB_FILE = 'job.json'
/** The claimed name. The RENAME is the claim: atomic, so two editors watching
 *  the same project cannot both run one job. */
export const UNREAL_CLAIMED_FILE = 'running_job.json'
export const UNREAL_RESULT_FILE = 'result.json'

/** Whether an installed bridge is the one this app ships. `0` (absent or
 *  unreadable) is NOT out of date — it is not installed, which is a different
 *  message and a different fix. */
export function bridgeOutdated(installed: number): boolean {
  return installed > 0 && installed !== UNREAL_BRIDGE_VERSION
}

/** The bridge plugin's folder name under `Plugins/` — also what
 *  `unrealProjectState` reports in `installedPlugins`, which is how the install
 *  dialog knows whether the project already has it. */
export const UNREAL_BRIDGE_NAME = 'DTHCharacterStudioRunner'
/** Where the bridge plugin is installed inside a project. */
export const UNREAL_BRIDGE_FOLDER = `Plugins/${UNREAL_BRIDGE_NAME}`
export const UNREAL_BRIDGE_UPLUGIN = `${UNREAL_BRIDGE_NAME}.uplugin`

/**
 * Bumped whenever the job or result shape changes. The bridge REFUSES a job
 * whose version it does not know rather than guessing, because the failure
 * mode of guessing is an import that reports success and imports nothing.
 *
 * The bridge is INSTALLED (not rewritten per run), so a mismatch is a real
 * possibility now — the studio therefore checks the installed `.uplugin`'s
 * `Version` before writing a job ({@link bridgeVersionFrom}) and says
 * "re-install it" up front, rather than queueing a job that comes back refused.
 *
 * History:
 * - 1 — `.dth` + destination.
 * - 2 — `files`: the export's own FBX list, so the bridge can find where those
 *   files are ALREADY imported and re-import there instead of duplicating them
 *   at the studio's guessed destination.
 * - 3 — `imports`: a LIST. One character can hold several export sets (the
 *   folder is named by the HDA's `character_name`, not by the character), and
 *   the handoff is one job file — so a job carries every set rather than the
 *   sets overwriting each other's job.
 * - 4 — `existing`: the studio located the set's assets itself and the
 *   destination is where they ARE. A bridge that ignored this would keep
 *   searching from inside Unreal and keep importing a second copy — exactly
 *   the silent wrong answer the version check exists to prevent.
 */
export const UNREAL_JOB_VERSION = 4

/**
 * The BRIDGE's own version — the shipped plugin's build, not the job contract.
 *
 * **Bump this on ANY change to the files the studio writes into a project**:
 * `dth_runner.py`, `init_unreal.py`, the `.uplugin`. A fix to the Python that
 * changes no contract still has to reach the projects that already have the old
 * one, and the studio has no other way to tell — a plugin folder holds whatever
 * was installed the day it was installed.
 *
 * Separate from {@link UNREAL_JOB_VERSION} because they answer different
 * questions. The job version is what the two sides must AGREE on, and only
 * changes when the job or result shape does. This one is "is the installed copy
 * the one this app ships", which is true far more often — every bug fix — and
 * is what puts the warning on a project card.
 *
 * History:
 * - 1 — the first shipped bridge (job contract 4): claim, import, re-import
 *   what the studio located, the progress dialog.
 * - 2 — a job that cannot be READ after it was claimed writes a failed result
 *   instead of going quiet. No contract change (hence the same
 *   {@link UNREAL_JOB_VERSION}) — and exactly the kind of fix this number
 *   exists for: it has to reach every project already holding v1.
 */
export const UNREAL_BRIDGE_VERSION = 2

/**
 * The bridge's own `.uplugin`.
 *
 * Content-only (no `Modules`): everything it does is Python, and a code module
 * would need compiling against each engine version — the one thing that would
 * make this stop working on a new UE. `EnabledByDefault` so a freshly
 * generated project runs it without anyone opening the plugin browser.
 */
export function bridgeUpluginJson(): string {
  return `${JSON.stringify(
    {
      FileVersion: 3,
      // Unreal's own plugin version fields, and the studio's staleness check
      // reads them back: `Version` is the number it compares.
      Version: UNREAL_BRIDGE_VERSION,
      VersionName: `1.${UNREAL_BRIDGE_VERSION}`,
      FriendlyName: 'DTH Character Studio Runner',
      Description:
        'Watches for an import job written by DTH Character Studio and runs the DazToHue import.',
      Category: 'Pipeline',
      CreatedBy: 'DTH Character Studio',
      CanContainContent: true,
      EnabledByDefault: true,
      Installed: false,
      Plugins: [{ Name: 'PythonScriptPlugin', Enabled: true }],
    },
    null,
    2,
  )}\n`
}

/** Absolute paths of everything the handoff touches, from the `.uproject`. */
export function unrealJobPaths(uprojectPath: string): {
  projectDir: string
  jobDir: string
  jobFile: string
  claimedFile: string
  resultFile: string
  bridgeDir: string
} {
  const projectDir = uprojectPath
    .replace(/\\/g, '/')
    .replace(/\/[^/]*$/, '')
    .replace(/\/+$/, '')
  const jobDir = `${projectDir}/${UNREAL_JOB_FOLDER}`
  return {
    projectDir,
    jobDir,
    jobFile: `${jobDir}/${UNREAL_JOB_FILE}`,
    claimedFile: `${jobDir}/${UNREAL_CLAIMED_FILE}`,
    resultFile: `${jobDir}/${UNREAL_RESULT_FILE}`,
    bridgeDir: `${projectDir}/${UNREAL_BRIDGE_FOLDER}`,
  }
}

/**
 * The Unreal content path a character imports into.
 *
 * `/Game/DazToHue/<Character>` — under the same root the DazToHue content
 * installs to, one folder per character. The pipeline derives every subfolder
 * (Textures, Materials, PoseAssets, Blueprints) from wherever its object asset
 * lands, so this one path decides the whole layout.
 */
export function unrealDestinationFor(characterName: string): string {
  return `/Game/DazToHue/${unrealFolderFor(characterName)}`
}

/**
 * An Unreal project folder + a folder inside its `Content/` → the content path
 * Unreal knows it by: `…/workflow3d` + `…/workflow3d/Content/Characters/Lara`
 * → `/Game/Characters/Lara`. `''` when the folder is not under `Content/`.
 *
 * `/Game` IS `Content/` — the mount point every project has — which is what
 * lets the studio hand the bridge a destination it worked out from the
 * filesystem, instead of the bridge having to find it from inside Unreal.
 */
export function unrealContentPath(projectDir: string, folderAbs: string): string {
  const root = `${projectDir.replace(/\\/g, '/').replace(/\/+$/, '')}/Content`
  const dir = folderAbs.replace(/\\/g, '/').replace(/\/+$/, '')
  if (dir.toLowerCase() === root.toLowerCase()) return '/Game'
  if (!dir.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return ''
  return `/Game/${dir.slice(root.length + 1)}`
}

/** The folder-name half of {@link unrealDestinationFor} — also the on-disk
 *  folder under `Content/DazToHue/`, which is how the studio can tell from the
 *  filesystem whether an Unreal project already holds an export set. */
export function unrealFolderFor(characterName: string): string {
  const clean = characterName
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return clean || 'Character'
}

/** One export set on its way into Unreal. */
export interface UnrealJobImport {
  /** The manifest to import — what triggers the DazToHue pipeline. */
  dth: string
  /** Where to import. With {@link UnrealJobImport.existing} this is where the
   *  set's assets ALREADY are; otherwise the default `/Game/DazToHue/<set>`. */
  destination: string
  /** The studio found this set's assets at `destination` — so the bridge
   *  imports on top of them (a re-import) instead of searching for them. */
  existing: boolean
  /** The export set's name (the HDA's `character_name`), for the log/report. */
  character: string
  /** The set's own FBX files — see {@link dthExportFiles}. */
  files: ReadonlyArray<string>
}

export function unrealJobJson(imports: ReadonlyArray<UnrealJobImport>): string {
  return `${JSON.stringify(
    {
      version: UNREAL_JOB_VERSION,
      imports: imports.map((one) => ({
        dth: one.dth.replace(/\\/g, '/'),
        destination: one.destination,
        existing: one.existing,
        character: one.character,
        files: one.files.map((file) => file.replace(/\\/g, '/')),
      })),
    },
    null,
    2,
  )}\n`
}

/**
 * Every FBX the export declares, out of the `.dth` manifest itself.
 *
 * The manifest is JSON and names its outputs by ABSOLUTE path — measured on
 * three real exports (DTH 2.5): `skeletal_meshes[].file` →
 * `…/<Character>/Skeletal Meshes/SKM_<Character>.fbx`, beside sections for
 * cloth panels, cloth-panel proxies, detached props, a collision proxy and pose
 * assets that were all empty there. So this does NOT read `skeletal_meshes`:
 * it walks the whole manifest and takes every string that ends in `.fbx`,
 * which picks up the sections this machine has never seen filled without
 * having to guess their shape — and picks up new ones a future DTH adds.
 *
 * Why the manifest rather than a directory listing: it is written BY the export
 * run, so it names what this export produced, not whatever else is lying in the
 * folder. Normalized to forward slashes, deduped case-insensitively (Windows),
 * sorted for a stable job file.
 */
export function dthExportFiles(text: string): Array<string> {
  let manifest: unknown
  try {
    manifest = JSON.parse(text)
  } catch {
    // A `.dth` that isn't JSON is the importer's problem to report, not a
    // reason to fail the send: no list simply means no re-import matching.
    return []
  }
  const found = new Map<string, string>()
  const walk = (node: unknown, depth: number): void => {
    if (depth > 12) return
    if (typeof node === 'string') {
      if (node.toLowerCase().endsWith('.fbx')) {
        const path = node.replace(/\\/g, '/')
        const key = path.toLowerCase()
        if (!found.has(key)) found.set(key, path)
      }
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1)
      return
    }
    if (node !== null && typeof node === 'object') {
      for (const value of Object.values(node)) walk(value, depth + 1)
    }
  }
  walk(manifest, 0)
  return [...found.values()].sort((a, b) => a.localeCompare(b))
}

/**
 * The `Version` an installed bridge's `.uplugin` declares — the number
 * {@link UNREAL_BRIDGE_VERSION} wrote into it. 0 = no bridge, unreadable, or a
 * manifest without the field, which every caller treats as "not installed".
 */
export function bridgeVersionFrom(uplugin: string): number {
  try {
    const parsed: unknown = JSON.parse(uplugin)
    if (parsed === null || typeof parsed !== 'object') return 0
    const version = (parsed as { Version?: unknown }).Version
    return typeof version === 'number' && Number.isFinite(version) ? version : 0
  } catch {
    return 0
  }
}

const resultSchema = z.object({
  version: z.number().default(0),
  state: z.enum(['running', 'done', 'failed']).default('running'),
  error: z.string().default(''),
  /** One entry per export set the job carried, in job order. */
  imports: z
    .array(
      z.object({
        character: z.string().default(''),
        /** Where it actually landed — the job's destination for a fresh
         *  import, the folder the existing assets live in for a re-import. */
        destination: z.string().default(''),
        /** `reimport` = the bridge found these files already imported and
         *  refreshed those assets in place; `import` = a fresh import. */
        mode: z.enum(['import', 'reimport']).default('import'),
        assets: z.array(z.string()).default([]),
      }),
    )
    .default([]),
})

export type UnrealImportResult = z.infer<typeof resultSchema>

/** Parse a result file, tolerating a torn read (the bridge writes it whole, but
 *  a poll can still land mid-write) — null means "ask again". */
export function parseUnrealResult(text: string): UnrealImportResult | null {
  try {
    return resultSchema.parse(JSON.parse(text))
  } catch {
    return null
  }
}

/** The job file, read BACK. The studio only ever wrote it ({@link unrealJobJson})
 *  until the reload-adoption needed to ask a found job file whose it is — the
 *  `dth` paths answer that (they point into one character's export folder). */
const jobSchema = z.object({
  version: z.number().default(0),
  imports: z
    .array(
      z.object({
        dth: z.string().default(''),
        destination: z.string().default(''),
        existing: z.boolean().default(false),
        character: z.string().default(''),
        files: z.array(z.string()).default([]),
      }),
    )
    .default([]),
})

export type UnrealJob = z.infer<typeof jobSchema>

/** Parse a job (or claimed) file, with {@link parseUnrealResult}'s tolerance:
 *  null means unreadable, never a throw — a job another studio version wrote
 *  is simply not adoptable. */
export function parseUnrealJob(text: string): UnrealJob | null {
  try {
    return jobSchema.parse(JSON.parse(text))
  } catch {
    return null
  }
}

export type UnrealImportState =
  /** The job file is still sitting there unclaimed: no editor is watching yet.
   *  Not an error — this is the "Unreal is still starting" stretch, and the one
   *  the user is most likely to see first. */
  | { state: 'waiting' }
  | { state: 'running' }
  | {
      state: 'finished'
      /** Assets touched across every set in the job. */
      assets: number
      /** What went wrong, '' when nothing did — and NOT only when the whole job
       *  failed: the bridge imports each export set independently and reports
       *  `done` as long as ONE landed, carrying the others' errors in this
       *  field. Reading it only on `state === 'failed'` is what let a job where
       *  two sets landed and a third blew up report as clean success. */
      error: string
      /** How many export sets the job carried. */
      sets: number
      /** True when at least one set landed on assets that were already there —
       *  the whole point of the file list. */
      reimported: boolean
      /** Where it landed: the one set's folder, or '' when several did. */
      destination: string
    }

/** What the studio can see of the running Unreal editors — the TS face of the
 *  Rust `unreal_open_projects` probe (see `unrealOpenProjectsSchema`).
 *  `unknown` editors are "cannot tell", never "not the one you asked about". */
export interface UnrealEditorProbe {
  editors: number
  projects: ReadonlyArray<string>
  unknown: number
  /** Whether the platform could enumerate editors AT ALL — false off Windows,
   *  where the Rust probe is a stub. A stub answers `editors: 0`, which is
   *  "nobody looked", not "nothing is running": any verdict that reads ZERO
   *  editors as a measurement must check this first (see
   *  {@link unrealImportAbandoned}). */
  probed: boolean
}

/** One `.uproject` path as an identity: slashes and case folded, spelling
 *  ignored — the same folding the send's own paths get. */
function uprojectKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

/** {@link UnrealEditorProbe.projects} holds this `.uproject`. */
export function editorHoldsProject(probe: UnrealEditorProbe, uprojectPath: string): boolean {
  const wanted = uprojectKey(uprojectPath)
  return probe.projects.some((open) => uprojectKey(open) === wanted)
}

/**
 * A CLAIMED import whose editor is gone can never finish — and until this
 * verdict existed, it didn't fail either: the first real editor crash
 * mid-import (2026-08-25, the day #964 shipped) left `running_job.json` and a
 * `result.json` frozen at `running` on disk, so every poll — across app
 * restarts, forever — re-derived "Working" from files no process would ever
 * update again, behind a deliberately inert button.
 *
 * The verdict is a liveness MEASUREMENT, not a timeout: the import runs
 * inside an editor process, so "no editor could be running this import" is
 * decisive. Two decisive shapes, same caution as {@link unrealLaunchVerdict}:
 *
 * - NO editor process at all — a crashed editor has no process; a frozen or
 *   just-launching one still does, so this cannot misfire on a slow import.
 * - every running editor identified, and none holds THIS project — editors
 *   of other projects can't be running our import.
 *
 * Any UNIDENTIFIED editor might be the target: not abandoned. Only ever asked
 * about a CLAIMED job — an unclaimed one waiting with no editor open is the
 * normal queue-then-open flow, not a death.
 *
 * And an UNPROBED platform decides nothing. Off Windows the Rust probe is a
 * stub answering `editors: 0` — which is "nobody looked", and reading it as a
 * measurement would fail every macOS import the moment its bridge claimed the
 * job. The Unreal leg is not Windows-only (nothing gates it, and the guide's
 * Windows-only list does not name it), so this is the one shape where zero
 * editors must NOT be believed. Same rule as `unknown`: what the studio
 * cannot see stays unseen, never guessed.
 */
export function unrealImportAbandoned(probe: UnrealEditorProbe, uprojectPath: string): boolean {
  if (!probe.probed) return false
  if (probe.editors === 0) return true
  if (probe.unknown > 0) return false
  return !editorHoldsProject(probe, uprojectPath)
}

/**
 * Whether the studio may open a queued job's `.uproject` itself, given what
 * the editor probe saw. The reasons are the caller's status line — each case
 * reads differently to the person watching a job that "does nothing".
 *
 * The old rule was "no editor may be running AT ALL", because the yes/no
 * probe could not tell WHAT was running — so a job queued while a different
 * project was open sat unclaimed forever behind an amber notice (reported
 * 2026-08-20). The command lines answer most of that:
 *
 * - the TARGET is open → never launch (a second editor on one project is the
 *   duplicate the old rule feared) — the open one claims the job, or says by
 *   not claiming that its bridge needs an editor restart.
 * - only OTHER projects are open, every editor identified → launch: editors
 *   of different projects run side by side by design, and the target opening
 *   is the rest of the leg.
 * - any editor UNIDENTIFIED → don't launch. It might be the target itself,
 *   and a wrong guess costs a duplicate editor; not launching costs a job
 *   that waits, which the status line now says out loud.
 */
export type UnrealLaunchVerdict =
  | { launch: true; reason: 'no-editor' | 'other-project' }
  | { launch: false; reason: 'target-open' | 'unknown-editor' }

export function unrealLaunchVerdict(
  probe: UnrealEditorProbe,
  uprojectPath: string,
): UnrealLaunchVerdict {
  if (editorHoldsProject(probe, uprojectPath)) return { launch: false, reason: 'target-open' }
  if (probe.editors === 0) return { launch: true, reason: 'no-editor' }
  if (probe.unknown === 0) return { launch: true, reason: 'other-project' }
  return { launch: false, reason: 'unknown-editor' }
}

/**
 * The send targets an UNIDENTIFIED running editor might be holding — or not.
 *
 * Empty means nothing to warn about: no editors, or every editor identified
 * (the launch verdict then handles each target for certain), or every target
 * seen open. Non-empty is the one state the studio cannot resolve at send
 * time, and the DTH Export panel warns about it AT THE START of the process —
 * the send happens minutes later, after the Daz and Houdini legs, which is a
 * late moment to learn the import may sit unclaimed.
 */
export function unidentifiedEditorTargets(
  probe: UnrealEditorProbe,
  targets: ReadonlyArray<string>,
): Array<string> {
  if (probe.unknown === 0) return []
  return targets.filter((target) => !editorHoldsProject(probe, target))
}

/**
 * What the studio should show, from the two files it can see.
 *
 * Has no `dead` of its own: the FILES cannot say whether the editor that
 * claimed the job is still alive — an editor closed mid-import leaves a
 * `running` result that never advances, and this function would report it as
 * running forever. That was the whole reading until 2026-08-25, when the first
 * real editor crash proved the cost: "Working", across app restarts, with no
 * dismiss offered for a state that never finishes.
 *
 * The missing half is a PROCESS measurement, and it lives outside this
 * function on purpose — {@link unrealImportAbandoned}, applied by
 * `fetchUnrealImportProgress` over the same command-line probe
 * {@link unrealLaunchVerdict} uses. Keeping the two apart is the point: this
 * one stays pure over the files, and the liveness verdict stays as cautious
 * about `unknown` (and about a platform that cannot look at all) as the launch
 * decision is.
 */
export function unrealImportStateFrom(
  jobStillPending: boolean,
  result: UnrealImportResult | null,
): UnrealImportState {
  if (result === null) return jobStillPending ? { state: 'waiting' } : { state: 'running' }
  if (result.state === 'running') return { state: 'running' }
  return {
    state: 'finished',
    assets: result.imports.reduce((total, one) => total + one.assets.length, 0),
    // A total failure always needs SOMETHING to show; a partial one carries the
    // bridge's own per-set message. `imports` holds only the sets that landed,
    // so `error` with a non-empty `imports` IS the partial case, and the caller
    // tells the two apart by that rather than by a flag neither side sets.
    error:
      result.state === 'failed' ? result.error || 'the import failed in Unreal' : result.error,
    sets: result.imports.length,
    reimported: result.imports.some((one) => one.mode === 'reimport'),
    // One set names its folder; several would need a list, and the toast is not
    // the place for one — the editor's log has them all.
    destination: result.imports.length === 1 ? result.imports[0].destination : '',
  }
}
