// The DTH Export feature (job-file contract v2): hand the character's
// ROM+export runs to the DTH Character Studio Runner as a JSON job file in
// the Daz library, starting Daz Studio when it isn't running. The Runner
// polls for the file (startup + regularly, so a running instance accepts new
// batches), RENAMES it (`running_` prefix — the "started" signal; only an
// un-renamed file can still be aborted by deletion), then works through the
// rows while updating the file's `progress` + per-job statuses. The studio
// polls the renamed file, deletes it at progress 100 and toasts the outcome.
// Contract: docs/exporter-plugin-job-file.md. The pure parts (JSON text,
// signatures) live in ../execute-jobs.ts. The scene choice is the export
// DIALOG's (the studio pre-checks the affected scenes via
// fetchExecuteScenes); this module takes the chosen list verbatim.
//
// THE IMPLEMENTATION LIVES IN `execute/`, which only ever imports downward — so
// working on one leg no longer means opening all of them:
//
//   primitives.ts  the character + its scenes root, the handoff stamps, the
//                  Daz-process probes and launch, the job-file paths
//   run-state.ts   the run sidecar (which window owns a run), the progress log,
//                  interrupt/abort, the job-file state the UI polls
//   jobs.ts        the handoff itself: affected scenes, the job file, launching
//                  Daz for a pending batch, generating a ROM animation
//   scans.ts       the scan runs riding the same handoff — whole-project,
//                  per-scene, and the ROM animations they produce
//
// THREE levels, not four: `jobs` and `scans` both sit on `run-state` as PEERS
// and never reference each other, so either can be read or changed on its own.
//
// This file stays the module's front door: everything the app imported from
// `api/execute` before the split is still exported here, unchanged.

export {
  characterScenesRoot,
  exportDazStudioRunning,
  exporterJobsPending,
  exporterJobsWorking,
  openSceneInRunningDaz,
} from './execute/primitives.ts'

export {
  ExporterJobFilesChangedError,
  abortExporterJobs,
  clearExporterJobFiles,
  dismissExportRun,
  exporterJobFilesSignature,
  fetchExporterJobFiles,
  fetchExportRunProgress,
  interruptExportRun,
} from './execute/run-state.ts'
export type { ExporterJobFileState, ExportRunProgress } from './execute/run-state.ts'

export {
  executeCharacterJobs,
  fetchExecuteScenes,
  generateRomAnimation,
  launchDazForPendingJobs,
} from './execute/jobs.ts'
export type { ExecuteJobsSummary, ExecuteSceneStatus } from './execute/jobs.ts'

export {
  PROJECT_SCAN_RUN,
  abortProjectScanRun,
  abortSceneScan,
  fetchProjectScanPlan,
  fetchRomAnimations,
  fetchSceneScanProgress,
  romAnimationFresh,
  startProjectScan,
  startSceneScan,
} from './execute/scans.ts'
export type {
  ProjectScanCharacter,
  ProjectScanPlan,
  ProjectScanSummary,
  RomAnimationStatus,
  SceneScanProgress,
  SceneScanStarted,
} from './execute/scans.ts'
