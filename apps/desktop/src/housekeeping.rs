use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{Duration, SystemTime};

use crate::fsutil::{entry_is_real_dir, rail_target, unsafe_recursive_target};

// --- Housekeeping: keep app-generated data from filling the disk -------------
// The app writes per-scene scan files into app-data (product-scan CSVs, the
// Scan_Frames keyframe CSVs) which pile up over time. This command ages them
// out on a schedule (launch + the Settings "Clean up now" button).

/// Files + bytes deleted by a housekeeping action (also the empty-quarantine result).
/// Wire shape mirrored by `housekeepingResultSchema` in apps/web's
/// `api/native-types.ts` and pinned by `contracts/sweep-report.json` (tests on
/// both sides).
#[derive(Serialize, Default)]
#[cfg_attr(test, derive(serde::Deserialize))]
#[serde(rename_all = "camelCase")]
pub(crate) struct SweepReport {
    files_deleted: u64,
    bytes_freed: u64,
    /// Files past the cutoff the sweep could NOT delete (locked/readonly).
    /// Without it they vanished from the report — "0 files freed" with every
    /// delete failing read as "nothing to do". Not surfaced in the UI yet; it
    /// exists so the wire format carries the truth.
    files_failed: u64,
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
                } else {
                    // Still best-effort (never fatal), but COUNTED — an
                    // undeletable file must not silently vanish from the report.
                    report.files_failed += 1;
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

/// Whether the sweep must refuse to run over `dir`: a zero retention window
/// (the cutoff would be "now", aging out essentially every scan file — a real
/// window is always > 0), a missing dir, or a root-ish target. The sweep
/// recursively deletes under a caller-supplied path, so like every sibling
/// recursive-delete in the crate it refuses a filesystem root / top-level
/// folder — judged on the canonical form (`rail_target`) so a `..`-laden or
/// junction spelling can't dress one up. Defense in depth even against a
/// poisoned resolved path; the TS caller is not the only safeguard.
fn refuse_sweep(dir: &Path, max_age_days: u64) -> bool {
    max_age_days == 0
        || unsafe_recursive_target(&rail_target(dir)).is_some()
        || !dir.is_dir()
}

/// Age-out stale product-scan files: delete those older than `max_age_days` and
/// drop the directories they emptied. Runs on launch + from the manual button.
// `(async)`: walks + deletes across app-data — off the main thread.
#[tauri::command(async)]
pub fn housekeeping_sweep(request: SweepRequest) -> SweepReport {
    let mut report = SweepReport::default();
    let dir = Path::new(&request.product_scans_dir);
    if refuse_sweep(dir, request.max_age_days) {
        return report;
    }
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(request.max_age_days.saturating_mul(86_400)))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    sweep_old_files(dir, cutoff, &mut report);
    report
}

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

    #[test]
    fn sweep_refuses_rootish_targets() {
        // The command recursively deletes under a caller-supplied dir, so the
        // shared recursive-delete rails must fire — on the CANONICAL path, so a
        // `..`-laden spelling of a root can't dodge them.
        let base = unique_temp_dir("sweep_rails");
        let deep = base.join("sub");
        fs::create_dir_all(&deep).unwrap();
        // The filesystem root itself (portably: the temp dir's last ancestor).
        let root = deep.ancestors().last().unwrap().to_path_buf();
        assert!(refuse_sweep(&root, 30), "a filesystem root must be refused");
        // A deep spelling that RESOLVES to the root (one `..` per real segment,
        // plus one — excess `..` clamps at the root) is refused too.
        let ups = deep
            .components()
            .filter(|c| matches!(c, std::path::Component::Normal(_)))
            .count();
        let mut sneaky = deep.clone();
        for _ in 0..ups + 1 {
            sneaky.push("..");
        }
        assert!(refuse_sweep(&sneaky, 30), "a canonical-root spelling must be refused");
        // A real deep dir with a sane retention window is allowed…
        assert!(!refuse_sweep(&deep, 30));
        // …but a zero retention window is refused (cutoff would be "now").
        assert!(refuse_sweep(&deep, 0));
        let _ = fs::remove_dir_all(&base);
    }

    // A no-share-delete open handle denies deletion on Windows only (Unix
    // unlinks an open file just fine), and Windows is the shipped target.
    // Readonly is no such lock anymore: std's remove_file deletes readonly
    // files via POSIX delete semantics on modern Windows.
    #[cfg(windows)]
    #[test]
    fn sweep_counts_undeletable_files_instead_of_hiding_them() {
        use std::os::windows::fs::OpenOptionsExt;
        // Every delete failing used to read as "0 files freed — nothing to do";
        // the failure must be visible in the report.
        let base = unique_temp_dir("sweep_failed");
        fs::create_dir_all(&base).unwrap();
        fs::write(base.join("Old.csv"), b"gone").unwrap();
        let locked = base.join("Locked.csv");
        fs::write(&locked, b"stay").unwrap();
        // Hold the file open with FILE_SHARE_READ only (std's default open
        // shares DELETE too) — the exact "Daz still has it open" failure mode.
        let handle = fs::OpenOptions::new()
            .read(true)
            .share_mode(1) // FILE_SHARE_READ
            .open(&locked)
            .unwrap();

        let mut report = SweepReport::default();
        let cutoff = SystemTime::now() + Duration::from_secs(86_400); // everything older
        sweep_old_files(&base, cutoff, &mut report);

        assert_eq!(report.files_deleted, 1);
        assert_eq!(report.bytes_freed, 4);
        assert_eq!(report.files_failed, 1, "the undeletable file is counted, not hidden");
        assert!(locked.exists(), "the locked file is left in place");
        drop(handle);
        let _ = fs::remove_dir_all(&base);
    }
}
