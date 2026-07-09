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
  fileCount: z.number(),
  isZip: z.boolean(),
  /** The copy kept (others are quarantined) — auto-picked, user-overridable. */
  isKeeper: z.boolean(),
})

/** A set of assets that are the same content — identical ('exact') or the same
 *  product at a different version ('version', e.g. a …UD vs …UPDATE). */
export const assetDupSchema = z.object({
  members: z.array(dupMemberSchema),
  kind: z.enum(['exact', 'version']),
  fixed: z.boolean(),
})

/** Result of the dedup scan/apply (mirrors Rust `DedupReport`). */
export const dedupReportSchema = z.object({
  dryRun: z.boolean(),
  conflicts: z.array(fileConflictSchema),
  duplicates: z.array(assetDupSchema),
  assetsQuarantined: z.number(),
  backupDir: z.string(),
})

// --- housekeeping (housekeeping.rs `SweepReport`) ----------------------------

/** Files + bytes removed by a housekeeping action (mirrors Rust `SweepReport`). */
export const housekeepingResultSchema = z.object({
  filesDeleted: z.number(),
  bytesFreed: z.number(),
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
