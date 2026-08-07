import { z } from 'zod'

/**
 * Zod schemas for the high-value structured RETURNS of the native (Rust) commands,
 * with the TS types inferred from them. These mirror the serde structs the Rust
 * side serializes (camelCase via `#[serde(rename_all = "camelCase")]`):
 *
 *   - `InstallStep` / `InstallReport`      → `apps/desktop/src/report.rs`
 *   - `ConflictCopy` / `FileConflict` /
 *     `DupMember` / `AssetDup` / `DedupReport` → `apps/desktop/src/dedup.rs`
 *   - `HousekeepingResult` (Rust `SweepReport`) → `apps/desktop/src/housekeeping.rs`
 *   - `RemapResult`                         → `apps/desktop/src/drives.rs`
 *   - `PoseAssetFrames`                     → `apps/desktop/src/poses.rs`
 *   - `SceneWearable` / `SceneWearables`    → `apps/desktop/src/poses.rs`
 *
 * The api layer parses each command result through these schemas (`Schema.parse(
 * await invoke(...))`) instead of a bare `invoke<T>()` cast, so a shape mismatch
 * throws AT the boundary it happens — rather than surfacing as a confusing
 * downstream error — the moment a Rust field is renamed and this file isn't
 * updated in lockstep. Keep the field names here byte-for-byte with the serde
 * camelCase output.
 */

// --- install reports (report.rs) ---------------------------------------------

/** One copy step of an install (mirrors the Rust `InstallStep`). */
export const installStepSchema = z.object({
  label: z.string(),
  files: z.number(),
  status: z.enum(['ok', 'skipped', 'error', 'header']),
  detail: z.string(),
  /** For asset steps: the (capped) list of files an install would copy. Rust
   *  always sends it (possibly empty); optional here to tolerate an empty omit. */
  filesList: z.array(z.string()).optional(),
  /** Set when this asset writes the same library files as another in the report
   *  (e.g. a folder and its .zip) — a "same files as …" duplicate hint. */
  note: z.string().optional(),
})

/** Outcome of an install run (mirrors the Rust `InstallReport`). */
export const installReportSchema = z.object({
  dryRun: z.boolean(),
  steps: z.array(installStepSchema),
  totalFiles: z.number(),
})

// --- dedup report (dedup.rs) -------------------------------------------------

/** One copy of a conflicting shared file (mirrors Rust `ConflictCopy`). */
export const conflictCopySchema = z.object({
  label: z.string(),
  /** Source folder the copy lives in (e.g. "_genesis 9"). */
  source: z.string(),
  /** Full path of the ASSET shipping this copy — the install's full-tie
   *  breaker: `winner_skip_map` (assets.rs) resolves an equal (genesis, size)
   *  tie to the lexicographically first asset path, and `conflictWinner`
   *  (dedup-report-list) mirrors that tiebreak with this key. Rust always
   *  sends it; optional here so report literals built without it (tests,
   *  browser no-ops) stay constructible. */
  path: z.string().optional(),
  size: z.number(),
  inZip: z.boolean(),
})

/** A file shipped by 2+ different products at different sizes. Informational —
 *  resolved by Accept (never rewritten). */
export const fileConflictSchema = z.object({
  rel: z.string(),
  copies: z.array(conflictCopySchema),
})

/** One copy in a duplicate group (mirrors Rust `DupMember`). */
export const dupMemberSchema = z.object({
  label: z.string(),
  /** Source folder the copy lives in (e.g. "_genesis 9"). */
  source: z.string(),
  /** Full path of this copy — unique by construction (labels collide inside an
   *  exact-dup group), so keeper choices, comparisons and React keys use it. */
  path: z.string(),
  fileCount: z.number(),
  isZip: z.boolean(),
  /** The copy kept (others are quarantined) — auto-picked, user-overridable
   *  via the request's `keepers` (paths). */
  isKeeper: z.boolean(),
  /** Set on apply when this redundant copy was fully moved to quarantine. */
  moved: z.boolean(),
  /** Empty, or why this copy couldn't be (fully) quarantined. */
  error: z.string(),
})

/** A set of assets that are the same content — identical paths AND sizes
 *  ('exact') or the same product at a different version ('version', e.g. a …UD
 *  vs …UPDATE). */
export const assetDupSchema = z.object({
  members: z.array(dupMemberSchema),
  kind: z.enum(['exact', 'version']),
  /** Set after apply: EVERY redundant copy of the group was quarantined. */
  fixed: z.boolean(),
})

/** Result of the dedup scan/apply (mirrors Rust `DedupReport`). */
export const dedupReportSchema = z.object({
  dryRun: z.boolean(),
  conflicts: z.array(fileConflictSchema),
  duplicates: z.array(assetDupSchema),
  assetsQuarantined: z.number(),
  backupDir: z.string(),
  /** Report-level failures: a quarantine folder inside a source, keeper choices
   *  that no longer resolve, groups skipped over an incomplete scan inventory. */
  errors: z.array(z.string()),
})

// --- pose-asset frame measurement (poses.rs) ---------------------------------

/** One measured `.duf` (mirrors Rust `PoseAssetFrames`). The measurement feeds
 *  the frame-alignment invariant, so its shape is guarded extra hard: parsed at
 *  the boundary here AND pinned by contracts/pose-asset-frames.json. */
export const poseAssetFramesSchema = z.object({
  path: z.string(),
  /** Frames the asset occupies (0 when it couldn't be measured — see `error`). */
  frames: z.number(),
  /** Empty on success; otherwise why the count couldn't be determined. */
  error: z.string(),
})

// --- scene wearables (poses.rs `SceneWearables`) ------------------------------

/** One fitted (conformed) item of a scene `.duf` (mirrors Rust `SceneWearable`).
 *  The groom-suggestion source: followers of the figure are the candidates for
 *  "keep this out of the export". */
export const sceneWearableSchema = z.object({
  /** The node's DSON id — what `conformTarget` refs point at (URL-encoded there). */
  id: z.string(),
  /** The label shown in Daz's Scene pane — what the groom list stores. */
  label: z.string(),
  /** Raw DSON ref of the fit target (e.g. "#Genesis9" or another wearable's id). */
  conformTarget: z.string(),
})

/** The base figure node of a scene `.duf` (mirrors Rust `SceneFigure`). Its id
 *  ("Genesis9", "Genesis8_1Female", …) is what the create dialog maps to a
 *  Genesis version + gender via `genesisFromFigureNode`. */
export const sceneFigureSchema = z.object({
  /** The figure node's DSON id — the auto-select source. */
  id: z.string(),
  /** The label shown in Daz's Scene pane (e.g. "Genesis 9"). */
  label: z.string(),
})

/** Result of reading a scene's conformed items + figure roots + timeline
 *  occupancy (mirrors Rust `SceneWearables`). Never a hard error: an unreadable
 *  scene comes back empty with the reason in `error`, so callers degrade
 *  instead of breaking. `figure` is null when the scene has no recognizable
 *  figure. */
export const sceneWearablesSchema = z.object({
  items: z.array(sceneWearableSchema),
  figure: sceneFigureSchema.nullable(),
  /** EVERY figure-like root node — the add-scene dialog's "exactly one
   *  character" check; `figure` above is its first entry. */
  figures: z.array(sceneFigureSchema),
  /** Timeline frames occupied by REAL animation — value-changing keys on the
   *  character's own (non-wearable) nodes; stray product keys on wearables'
   *  bones don't count (see poses.rs `duf_scene`). Above 1 = a genuinely
   *  filled timeline (the add-scene/create dialogs flag it — the ROM script
   *  fills the timeline itself). */
  animationFrames: z.number(),
  error: z.string(),
})

// --- housekeeping (housekeeping.rs `SweepReport`) ----------------------------

/** Files + bytes removed by a housekeeping action (mirrors Rust `SweepReport`). */
export const housekeepingResultSchema = z.object({
  filesDeleted: z.number(),
  bytesFreed: z.number(),
  /** Files past the cutoff the sweep could NOT delete (locked/readonly) — so
   *  every-delete-failing no longer reads as "0 files freed, nothing to do".
   *  Rust always sends it; optional here so browser no-op / aggregated results
   *  (maintenance.ts) stay constructible without it. Surfaced by the
   *  Housekeeping "Clean up now" toast (the launch sweep stays silent). */
  filesFailed: z.number().optional(),
})

// --- network-drive remap (drives.rs `RemapResult`) ----------------------------

/** Outcome of ensuring one known network drive is mapped (mirrors Rust
 *  `RemapResult`). Produced on startup — re-mapping drives an elevated relaunch
 *  can't see (see drives.rs). */
export const remapResultSchema = z.object({
  /** Drive specifier, e.g. "X:". */
  drive: z.string(),
  /** UNC target, e.g. "\\\\jebpot\\devs". */
  unc: z.string(),
  status: z.enum(['already', 'remapped', 'conflict', 'failed']),
  /** Empty, or why the drive couldn't be (re)mapped. */
  detail: z.string(),
})

// --- DazToHue material utilities (houdini_material.rs) -----------------------

/** One material slot on a node, with the bakers that name it — the unit the
 *  panel lets you pick, because "the same skin" is what gets reused. */
export const materialSlotInfoSchema = z.object({
  /** Slot name as stored (`Skin`). */
  name: z.string(),
  /** Name as a baker spells it, with the node's prefix (`MI_Skin`). */
  displayName: z.string(),
  /** The Daz surfaces merged into this slot, as the RAW group expressions the
   *  node stores (`@fbx_material_name=Body`) — a G9 skin merges ~15. Raw
   *  because these are also the merge rule's input: the panel compares claims
   *  verbatim to preview what a transfer replaces (`houdini-material-merge.ts`). */
  surfaces: z.array(z.string()),
  bakers: z.number(),
  layers: z.number(),
  /** UV names this slot's bakers read that only a UV channel produces. Empty =
   *  copies fine without the UV channels (measured: clothing; skin needs
   *  `uv_geoshell`). */
  channelUvs: z.array(z.string()),
})

/** How much is configured in one section of a node (the skeleton node's tabs). */
export const sectionCountInfoSchema = z.object({
  key: z.string(),
  /** Human label as the HDA spells it ("Skin Weights"). */
  label: z.string(),
  /** Non-default settings plus list entries — what the user changed. */
  count: z.number(),
})

/** One DazToHue node found by a scan (a material or a skeleton node). */
export const materialNodeInfoSchema = z.object({
  /** Node path in the scene, e.g. `/obj/DazToHue/DazToHueMaterial`. */
  path: z.string(),
  name: z.string(),
  /** Which panel tab owns this node: `material` or `skeleton`. One scan
   *  returns both kinds, so switching tab costs no second hython run. */
  nodeType: z.string(),
  /** Title of the network box wrapping this node ('' when there is none) —
   *  what users actually name their DTH networks (`KiraDefault`, `KiraYoga`),
   *  since the nodes are only ever `DazToHueMaterial`, `…1`, `…2`. */
  networkBox: z.string(),
  materials: z.number(),
  uvChannels: z.number(),
  bakers: z.number(),
  /** Total baker layers — how much hand-work the setup represents. */
  layers: z.number(),
  bakerNames: z.array(z.string()),
  /** Slot names with AND without the node's prefix, so a baker's material
   *  (`MI_Skin`) can be matched however the target spells it. */
  materialNames: z.array(z.string()),
  /** The node's material slots, each with its bakers — empty for a skeleton. */
  slots: z.array(materialSlotInfoSchema),
  /** Per-section counts for the skeleton node's tabs — empty for a material. */
  sectionCounts: z.array(sectionCountInfoSchema),
})

/** How portable a project's stored file references are. Computed by the SAME
 *  helpers the `repath` op runs (in dry mode), so the Defaults tab can never
 *  promise a number the action then doesn't deliver. */
export const projectRefInfoSchema = z.object({
  /** Absolute references under `$HIP`/`$JOB`/`$DAZ3D_LIB` — expressible
   *  relative to one of them. */
  collapsible: z.number(),
  /** Absolute references under none of those roots: reported, never touched. */
  foreign: z.number(),
  /** DazToHue import references whose file is not there, as `<node> <parm>`.
   *  Scoped to those parms because "the file is missing" is NOT a usable
   *  definition of broken in general — measured, a healthy project reports four
   *  of Houdini's own scratch files that simply don't exist until used. */
  broken: z.array(z.string()),
})

/** One import reference a repath rebuilt. */
export const repairedRefSchema = z.object({
  /** `<node path> <parm name>`. */
  label: z.string(),
  from: z.string(),
  to: z.string(),
})

/** What the `repath` op did (or would do) to one project. */
export const repathResultSchema = z.object({
  hipPath: z.string(),
  ok: z.boolean(),
  error: z.string(),
  /** References rewritten from an absolute path to a `$VAR`-relative one. */
  collapsed: z.number(),
  /** Broken DazToHue import references rebuilt from a sibling that resolved. */
  repaired: z.array(repairedRefSchema),
  /** Absolute references left alone because they sit under no known root. */
  foreign: z.array(z.string()),
  /** Pre-repath backup (empty for a dry run, and when nothing changed). */
  backupPath: z.string(),
})

/** The Generate-project wiring as it applies to an EXISTING project. Both lists
 *  are feature-detected against the installed HDA, which is what lets the
 *  action ship before the DazToHue release adding the PoseAsset CSV path. */
export const projectPrefillInfoSchema = z.object({
  /** Parms that exist here and are currently BLANK — the only ones a prefill
   *  writes, so it can never overwrite a value the user set. */
  fillable: z.array(z.string()),
  /** Parms this DazToHue version doesn't carry at all (today: the PoseAsset
   *  CSV path). Named rather than skipped silently. */
  missing: z.array(z.string()),
})

/** One parm a prefill wrote, or would write. */
export const prefilledParmSchema = z.object({
  label: z.string(),
  value: z.string(),
})

/** What the `prefill` op did (or would do) to one project. */
export const prefillResultSchema = z.object({
  hipPath: z.string(),
  ok: z.boolean(),
  error: z.string(),
  filled: z.array(prefilledParmSchema),
  /** Parms this DazToHue version doesn't have — the release gap, named. */
  skippedMissing: z.array(z.string()),
  /** Parms left alone because the user had already set them. */
  skippedSet: z.array(z.string()),
  backupPath: z.string(),
})

/** One scanned `.hip` (`ok: false` = unreadable; the scan itself still succeeds). */
export const materialScanProjectSchema = z.object({
  hipPath: z.string(),
  ok: z.boolean(),
  error: z.string(),
  nodes: z.array(materialNodeInfoSchema),
  /** The `$JOB` this scene carries — scene state saved with the `.hip`, so a
   *  project keeps whatever it was created with. Read in the same pass as the
   *  nodes (opening a `.hip` costs tens of seconds). Empty only when the
   *  project could not be read. */
  job: z.string(),
  /** The folder the `.hip` sits in, i.e. `$HIP` — derived, never rewritten. */
  hipDir: z.string(),
  /** What a repath would do to this project's stored file references. */
  refs: projectRefInfoSchema,
  /** Which DazToHue parms the studio could fill here, and which this DazToHue
   *  version doesn't carry at all. */
  prefill: projectPrefillInfoSchema,
})

/** What the `defaults` operation did (or would do) to one project's `$JOB`.
 *
 *  Houdini's file picker collapses a chosen path to a variable only when it
 *  sits under `$HIP` or `$JOB`. A pre-v0.64 project carries
 *  `<char>/houdini/houdini-project` — BELOW the exports, so it could never
 *  help and every hand-picked export came back absolute. */
export const houdiniDefaultsResultSchema = z.object({
  hipPath: z.string(),
  ok: z.boolean(),
  error: z.string(),
  /** The `$JOB` the scene carried before the run. */
  previousJob: z.string(),
  /** The `$JOB` it carries now — for a dry run, what it WOULD carry. */
  job: z.string(),
  /** false = already correct, so nothing was written. */
  changed: z.boolean(),
  /** Pre-repair backup (empty for a dry run, and when nothing changed). */
  backupPath: z.string(),
})

/** What one transferred section did to a target node. */
export const materialSectionResultSchema = z.object({
  /** `materials`, `uvChannels` or `bakers`. */
  key: z.string(),
  before: z.number(),
  after: z.number(),
  /** Target material slots this run removed, by name: those whose surfaces the
   *  incoming slots now claim, plus any whose NAME an incoming slot carries.
   *  A surface belongs to exactly one slot, so making room is part of
   *  installing one. Empty for the other sections. */
  evicted: z.array(z.string()),
  /** Target slots that survived but lost the surfaces that moved — dropping
   *  them whole would orphan the surfaces nothing else claims. */
  trimmed: z.array(z.string()),
})

/** What a transfer did — or, in a dry run, would do — to one target node. */
export const materialTransferTargetSchema = z.object({
  hipPath: z.string(),
  nodePath: z.string(),
  ok: z.boolean(),
  error: z.string(),
  sections: z.array(materialSectionResultSchema),
  added: z.array(z.string()),
  replaced: z.boolean(),
  /** Materials the copied bakers name that this target will STILL not define
   *  after the run (its own slots PLUS whatever the `materials` section
   *  installs). A baker with an unknown material imports fine and then bakes
   *  nothing — so this is precisely what the user must set up by hand. */
  missingMaterials: z.array(z.string()),
  /** Groups the copied layers name that the target's geometry lacks. Empty
   *  ALSO means "couldn't be checked" (no cooked geometry) — never read it as
   *  "all present". */
  missingGroups: z.array(z.string()),
  /** UV names the copied bakers read that only a UV channel produces, when the
   *  channels aren't part of this run — the answer to "do I need the UV
   *  channels too?". Empty for a clothing material. */
  missingUvSources: z.array(z.string()),
  /** Surfaces the incoming slots claim that NO slot on this target claims
   *  today. A few is ordinary (the source wears something the target doesn't);
   *  ALL of them on a large set means the two nodes describe different figures
   *  — what copying a G9 skin onto a G8 character would look like. The studio
   *  has not measured how generations name surfaces, so this is the symptom,
   *  not a generation check. */
  unclaimedSurfaces: z.array(z.string()),
  /** Rolling pre-transfer backup (empty for a dry run). */
  backupPath: z.string(),
})

/** The report of either material-utility operation (mirrors the Rust
 *  `MaterialUtilReport`). */
export const materialUtilReportSchema = z.object({
  op: z.string(),
  ok: z.boolean(),
  error: z.string(),
  projects: z.array(materialScanProjectSchema),
  targets: z.array(materialTransferTargetSchema),
  /** Populated by `defaults` — one entry per project it was asked about. */
  defaults: z.array(houdiniDefaultsResultSchema),
  /** Populated by `repath` — one entry per project it was asked about. */
  repath: z.array(repathResultSchema),
  /** Populated by `prefill` — one entry per project it was asked about. */
  prefill: z.array(prefillResultSchema),
  sourceBakers: z.number(),
  sourceLayers: z.number(),
  sourceBakerNames: z.array(z.string()),
  /** The sections this run was asked to transfer. */
  sections: z.array(z.string()),
  /** Material slot names it was restricted to (empty = all). */
  materials: z.array(z.string()),
  /** Whether Daz-library texture paths were pointed at `$DAZ3D_LIB`. */
  useLibVar: z.boolean(),
  rewrittenPaths: z.number(),
  /** Absolute paths left alone because they live outside the Daz library. */
  foreignPaths: z.array(z.string()),
  dryRun: z.boolean(),
  replace: z.boolean(),
})

// --- inferred TS types (single source of truth is the schemas above) ---------

export type InstallStep = z.infer<typeof installStepSchema>
export type InstallReport = z.infer<typeof installReportSchema>
export type ConflictCopy = z.infer<typeof conflictCopySchema>
export type FileConflict = z.infer<typeof fileConflictSchema>
export type DupMember = z.infer<typeof dupMemberSchema>
export type AssetDup = z.infer<typeof assetDupSchema>
export type DedupReport = z.infer<typeof dedupReportSchema>
export type HousekeepingResult = z.infer<typeof housekeepingResultSchema>
export type RemapResult = z.infer<typeof remapResultSchema>
export type PoseAssetFramesResult = z.infer<typeof poseAssetFramesSchema>
export type SceneWearable = z.infer<typeof sceneWearableSchema>
export type SceneWearables = z.infer<typeof sceneWearablesSchema>
export type MaterialSlotInfo = z.infer<typeof materialSlotInfoSchema>
export type MaterialNodeInfo = z.infer<typeof materialNodeInfoSchema>
export type MaterialSectionResult = z.infer<typeof materialSectionResultSchema>
export type MaterialScanProject = z.infer<typeof materialScanProjectSchema>
export type MaterialTransferTarget = z.infer<typeof materialTransferTargetSchema>
export type HoudiniDefaultsResult = z.infer<typeof houdiniDefaultsResultSchema>
export type ProjectRefInfo = z.infer<typeof projectRefInfoSchema>
export type RepathResult = z.infer<typeof repathResultSchema>
export type ProjectPrefillInfo = z.infer<typeof projectPrefillInfoSchema>
export type PrefillResult = z.infer<typeof prefillResultSchema>
export type MaterialUtilReport = z.infer<typeof materialUtilReportSchema>
