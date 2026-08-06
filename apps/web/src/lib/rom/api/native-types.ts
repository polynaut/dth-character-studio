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

/** One DazToHueMaterial node found by a scan. */
export const materialNodeInfoSchema = z.object({
  /** Node path in the scene, e.g. `/obj/DazToHue/DazToHueMaterial`. */
  path: z.string(),
  name: z.string(),
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
})

/** One scanned `.hip` (`ok: false` = unreadable; the scan itself still succeeds). */
export const materialScanProjectSchema = z.object({
  hipPath: z.string(),
  ok: z.boolean(),
  error: z.string(),
  nodes: z.array(materialNodeInfoSchema),
})

/** What a transfer did — or, in a dry run, would do — to one target node. */
export const materialTransferTargetSchema = z.object({
  hipPath: z.string(),
  nodePath: z.string(),
  ok: z.boolean(),
  error: z.string(),
  bakersBefore: z.number(),
  bakersAfter: z.number(),
  added: z.array(z.string()),
  replaced: z.boolean(),
  /** Materials the copied bakers name that this target doesn't define — a
   *  baker with an unknown material imports fine and then bakes nothing. */
  missingMaterials: z.array(z.string()),
  /** Groups the copied layers name that the target's geometry lacks. Empty
   *  ALSO means "couldn't be checked" (no cooked geometry) — never read it as
   *  "all present". */
  missingGroups: z.array(z.string()),
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
  sourceBakers: z.number(),
  sourceLayers: z.number(),
  sourceBakerNames: z.array(z.string()),
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
export type MaterialNodeInfo = z.infer<typeof materialNodeInfoSchema>
export type MaterialScanProject = z.infer<typeof materialScanProjectSchema>
export type MaterialTransferTarget = z.infer<typeof materialTransferTargetSchema>
export type MaterialUtilReport = z.infer<typeof materialUtilReportSchema>
