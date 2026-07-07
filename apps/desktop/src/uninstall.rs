use serde::Deserialize;
use std::fs;
use std::path::Path;

use crate::fsutil::{count_files, looks_like_daz_folder, rail_target, unsafe_recursive_target};
use crate::report::{io_detail, step_err, step_ok, step_skip, InstallReport, InstallStep};

// --- "Danger zone": clean up leftover Daz folders after uninstalling Daz -----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UninstallDefaultsRequest {
    daz_lib_folder: String,
}

/// The default leftover-folder list (ported from the dth-cli `uninstall-daz`): the
/// user's DAZ library folder, the common Documents / Public library spots, and the
/// APPDATA `DAZ 3D` + Start-Menu folders. NB: we push the library folder ITSELF,
/// never its parent — the parent is typically the whole Documents folder, and this
/// list is prefilled straight into a recursive delete.
#[tauri::command]
pub fn default_daz_uninstall_folders(request: UninstallDefaultsRequest) -> Vec<String> {
    let mut folders: Vec<String> = Vec::new();
    let lib = request.daz_lib_folder.trim();
    if !lib.is_empty() {
        folders.push(lib.to_string());
    }
    folders.push("D:\\User Data\\Documents\\DAZ 3D".into());
    folders.push("E:\\User Data\\Documents\\DAZ 3D".into());
    folders.push("C:\\Users\\Public\\Documents\\My DAZ 3D Library".into());
    folders.push("C:\\Program Files\\DAZ 3D\\DAZStudio6".into());
    folders.push("C:\\Program Files\\DAZ 3D\\DAZStudio4".into());
    if let Ok(appdata) = std::env::var("APPDATA") {
        folders.push(format!("{appdata}\\DAZ 3D"));
        folders.push(format!("{appdata}\\Microsoft\\Windows\\Start Menu\\Programs\\DAZ 3D"));
    }
    // The full candidate list — NOT filtered by existence. Whether a folder is there
    // is checked at delete time (the uninstall reports missing ones as "not found"),
    // so the list stays complete regardless of Daz's install state when prefilled.
    folders
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UninstallDazRequest {
    folders: Vec<String>,
    dry_run: bool,
}

/// Delete the listed leftover Daz folders (run after removing Daz Studio / DIM via
/// Add or Remove Programs). Recursive — these are whole folders. Each step reports
/// deleted / not found / error; `dry_run` only counts what would be removed.
#[tauri::command]
pub fn uninstall_daz(request: UninstallDazRequest) -> InstallReport {
    let dry = request.dry_run;
    let mut steps: Vec<InstallStep> = Vec::new();
    for folder in &request.folders {
        let trimmed = folder.trim();
        if trimmed.is_empty() {
            continue;
        }
        let p = Path::new(trimmed);
        // Rails: never recursively delete a non-Daz folder (a stray/poisoned path
        // like the user's Documents) or a drive/profile root — even on a dry run
        // we surface the refusal so the user sees it can't happen. They judge the
        // CANONICAL path when the target exists (rail_target), so a junction or a
        // `..`-laden spelling can't smuggle a dangerous target past them.
        let canon = rail_target(p);
        if let Some(reason) = unsafe_recursive_target(&canon) {
            steps.push(step_err(trimmed, reason));
            continue;
        }
        if !looks_like_daz_folder(&canon) {
            steps.push(step_err(trimmed, "refused: not a recognised Daz folder (no “DAZ” in the path)".into()));
            continue;
        }
        if !p.exists() {
            steps.push(step_skip(trimmed, "not found".into()));
        } else if dry {
            steps.push(step_ok(trimmed, count_files(p), "would delete".into()));
        } else {
            match fs::remove_dir_all(p) {
                Ok(_) => steps.push(step_ok(trimmed, 0, "deleted".into())),
                Err(e) => steps.push(step_err(trimmed, io_detail("delete", &e))),
            }
        }
    }
    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: dry, steps, total_files }
}
