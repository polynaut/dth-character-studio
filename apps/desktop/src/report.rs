use serde::Serialize;

/// Shared guidance for the failures that need elevation (or a locked DLL).
pub(crate) const ADMIN_HINT: &str =
    "close all Daz and Houdini apps, then restart DTH Character Studio as administrator and try again";

/// Format an IO error, appending the admin guidance for permission failures.
pub(crate) fn io_detail(prefix: &str, e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        format!("{prefix}: access denied — {ADMIN_HINT}")
    } else {
        format!("{prefix}: {e}")
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallStep {
    pub(crate) label: String,
    pub(crate) files: u64,
    /// "ok" | "skipped" | "error" | "header".
    pub(crate) status: String,
    pub(crate) detail: String,
    /// Per-asset detail: the (capped) list of files an install would copy.
    pub(crate) files_list: Vec<String>,
    /// A hint shown beside the row — set when this asset writes the same library
    /// files as another in the report (e.g. a folder and its `.zip`). Empty otherwise.
    pub(crate) note: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallReport {
    pub(crate) dry_run: bool,
    pub(crate) steps: Vec<InstallStep>,
    pub(crate) total_files: u64,
}

pub(crate) fn step_ok(label: &str, files: u64, detail: String) -> InstallStep {
    InstallStep { label: label.into(), files, status: "ok".into(), detail, files_list: Vec::new(), note: String::new() }
}
pub(crate) fn step_skip(label: &str, reason: String) -> InstallStep {
    InstallStep { label: label.into(), files: 0, status: "skipped".into(), detail: reason, files_list: Vec::new(), note: String::new() }
}
pub(crate) fn step_err(label: &str, msg: String) -> InstallStep {
    InstallStep { label: label.into(), files: 0, status: "error".into(), detail: msg, files_list: Vec::new(), note: String::new() }
}
/// A group header row (a source folder) — rendered as a heading, not a step.
pub(crate) fn step_header(label: &str) -> InstallStep {
    InstallStep { label: label.into(), files: 0, status: "header".into(), detail: String::new(), files_list: Vec::new(), note: String::new() }
}

