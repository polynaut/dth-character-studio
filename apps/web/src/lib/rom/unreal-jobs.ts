import { z } from 'zod'

/**
 * The Unreal import handoff — the studio's third job-file contract, and
 * deliberately the same shape as the other two.
 *
 * Daz gets `dth_exporter_jobs.json` claimed by the Runner; Houdini gets
 * `.dth_houdini_job.json` claimed by 456.py; Unreal gets `job.json` claimed by
 * the studio's own bridge plugin (`unreal-runtime/dth_bridge.py`). Same three
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

/** The bridge plugin's folder name under `Plugins/` — also what
 *  `unrealProjectState` reports in `installedPlugins`, which is how the install
 *  dialog knows whether the project already has it. */
export const UNREAL_BRIDGE_NAME = 'DTHStudioBridge'
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
 */
export const UNREAL_JOB_VERSION = 2

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
      Version: UNREAL_JOB_VERSION,
      VersionName: '1.0',
      FriendlyName: 'DTH Studio Bridge',
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
  const clean = characterName
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `/Game/DazToHue/${clean || 'Character'}`
}

export function unrealJobJson(job: {
  dth: string
  destination: string
  character: string
  /** The export's own FBX files — see {@link dthExportFiles}. */
  files: ReadonlyArray<string>
}): string {
  return `${JSON.stringify(
    {
      version: UNREAL_JOB_VERSION,
      dth: job.dth.replace(/\\/g, '/'),
      destination: job.destination,
      character: job.character,
      files: job.files.map((file) => file.replace(/\\/g, '/')),
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
 * The `Version` an installed bridge's `.uplugin` declares — the same number
 * {@link UNREAL_JOB_VERSION} writes into it. 0 = no bridge, unreadable, or a
 * manifest without the field, which the caller treats as "not installed".
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
  assets: z.array(z.string()).default([]),
  character: z.string().default(''),
  /** Where it actually landed — the job's destination for a fresh import, the
   *  folder the existing assets live in for a re-import. */
  destination: z.string().default(''),
  /** `reimport` = the bridge found these files already imported and refreshed
   *  those assets in place; `import` = a fresh import at the job's destination.
   *  Defaulted, so a version-1 bridge's result still parses. */
  mode: z.enum(['import', 'reimport']).default('import'),
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

export type UnrealImportState =
  /** The job file is still sitting there unclaimed: no editor is watching yet.
   *  Not an error — this is the "Unreal is still starting" stretch, and the one
   *  the user is most likely to see first. */
  | { state: 'waiting' }
  | { state: 'running' }
  | {
      state: 'finished'
      assets: number
      error: string
      /** What the bridge did — see the result schema's `mode`. */
      mode: 'import' | 'reimport'
      /** The content path it landed in, which for a re-import is where the
       *  assets already were, not what the job asked for. */
      destination: string
    }

/**
 * What the studio should show, from the two files it can see.
 *
 * Deliberately has no `dead`: unlike Daz and Houdini there is no liveness
 * probe here — an editor the user closed mid-import leaves a `running` result
 * that never advances. Reporting that as failure would be a guess; the user
 * can see their own editor. (A process check could be added, but "is THAT
 * project open" is not answerable from a process list.)
 */
export function unrealImportStateFrom(
  jobStillPending: boolean,
  result: UnrealImportResult | null,
): UnrealImportState {
  if (result === null) return jobStillPending ? { state: 'waiting' } : { state: 'running' }
  if (result.state === 'running') return { state: 'running' }
  return {
    state: 'finished',
    assets: result.assets.length,
    error: result.state === 'failed' ? result.error || 'the import failed in Unreal' : '',
    mode: result.mode,
    destination: result.destination,
  }
}
