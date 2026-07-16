use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use crate::fsutil::entry_is_real_dir;

// --- Housekeeping: keep app-generated data from filling the disk -------------
// The app writes per-scene scan files into app-data (product-scan CSVs, the
// Scan_Frames keyframe CSVs) which pile up over time. This command ages them
// out on a schedule (launch + the Settings "Clean up now" button).

/// Files + bytes deleted by a housekeeping action (also the empty-quarantine result).
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SweepReport {
    files_deleted: u64,
    bytes_freed: u64,
}

/// Delete every file under `dir` last modified before `cutoff`, then remove any
/// directory left empty. Best-effort — an unreadable dir / undeletable file is
/// skipped, never fatal.
fn sweep_old_files(dir: &Path, cutoff: SystemTime, report: &mut SweepReport) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // entry_is_real_dir does NOT follow symlinks — the sweep can't escape the
        // app-data tree through a junction and delete files elsewhere.
        if entry_is_real_dir(&entry) {
            sweep_old_files(&path, cutoff, report);
            // Remove the directory if the sweep emptied it (keep non-empty ones).
            if fs::read_dir(&path).map(|mut d| d.next().is_none()).unwrap_or(false) {
                let _ = fs::remove_dir(&path);
            }
        } else if let Ok(md) = entry.metadata() {
            // A file with no readable mtime is left alone (never wrongly aged out).
            if md.modified().map(|m| m < cutoff).unwrap_or(false) {
                let len = md.len();
                if fs::remove_file(&path).is_ok() {
                    report.files_deleted += 1;
                    report.bytes_freed += len;
                }
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SweepRequest {
    /// The app-data `product-scans` root to age-out (resolved in TS).
    product_scans_dir: String,
    /// Delete scan files not modified within this many days.
    max_age_days: u64,
}

/// Age-out stale product-scan files: delete those older than `max_age_days` and
/// drop the directories they emptied. Runs on launch + from the manual button.
#[tauri::command]
pub fn housekeeping_sweep(request: SweepRequest) -> SweepReport {
    let mut report = SweepReport::default();
    let dir = Path::new(&request.product_scans_dir);
    // max_age_days == 0 would set the cutoff to "now" and delete essentially every
    // scan file — refuse it (a real retention window is always > 0).
    if request.max_age_days == 0 || !dir.is_dir() {
        return report;
    }
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(request.max_age_days.saturating_mul(86_400)))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    sweep_old_files(dir, cutoff, &mut report);
    report
}

/// Whether a folder exists + its total file count and size — for the quarantine
/// size readout in Tools.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::unique_temp_dir;

    #[test]
    fn sweep_deletes_files_past_the_cutoff_and_prunes_emptied_dirs() {
        // std has no portable mtime setter, so drive the boundary via the cutoff:
        // a cutoff in the far future makes every just-written file count as "old".
        let base = unique_temp_dir("sweep_all");
        let scene = base.join("proj").join("char");
        fs::create_dir_all(&scene).unwrap();
        fs::write(scene.join("SceneA.csv"), b"aaaa").unwrap();
        fs::write(scene.join("SceneB.csv"), b"bb").unwrap();

        let mut report = SweepReport::default();
        let cutoff = SystemTime::now() + Duration::from_secs(86_400); // everything older
        sweep_old_files(&base, cutoff, &mut report);

        assert_eq!(report.files_deleted, 2);
        assert_eq!(report.bytes_freed, 6);
        // The emptied <char> (then <proj>) directories are pruned by the recursion.
        assert!(!scene.exists(), "the emptied character dir is removed");
        assert!(!base.join("proj").exists(), "the emptied project dir is removed");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn sweep_keeps_files_newer_than_the_cutoff() {
        // A cutoff at the epoch: every just-written file is newer, so nothing goes.
        let base = unique_temp_dir("sweep_none");
        let scene = base.join("proj").join("char");
        fs::create_dir_all(&scene).unwrap();
        fs::write(scene.join("Fresh.csv"), b"keep me").unwrap();

        let mut report = SweepReport::default();
        sweep_old_files(&base, SystemTime::UNIX_EPOCH, &mut report);

        assert_eq!(report.files_deleted, 0);
        assert!(scene.join("Fresh.csv").exists(), "a fresh file must be kept");
        let _ = fs::remove_dir_all(&base);
    }
}
