use serde::{Deserialize, Serialize};

/// Shared guidance for the failures that need elevation (or a locked DLL).
pub(crate) const ADMIN_HINT: &str =
    "close all Daz and Houdini apps, then restart DTH Character Studio as administrator and try again";

/// The plugin install's own version of the above. It does NOT ask for a restart:
/// that path elevates on demand instead (see `elevate.rs`), so the way forward is
/// one button, not a relaunch of the whole studio.
pub(crate) const PLUGIN_ADMIN_HINT: &str =
    "writing there needs administrator rights — use \"Install with administrator rights\"";

/// And what to say when the ELEVATED attempt is the one that was refused —
/// repeating "use administrator rights" to someone who just did is a dead end.
pub(crate) const PLUGIN_ELEVATED_DENIED_HINT: &str =
    "access was denied even with administrator rights — check the folder's permissions";

/// A loaded plugin DLL is locked by Daz Studio itself; no amount of elevation
/// unlocks it. Kept separate from the admin hints on purpose: fusing the two
/// turns the elevation button into a cargo cult (click, fail, distrust it).
pub(crate) const PLUGIN_LOCKED_HINT: &str =
    "Daz Studio has this plugin loaded — close every Daz Studio window and try again";

/// Format an IO error, appending the admin guidance for permission failures.
pub(crate) fn io_detail(prefix: &str, e: &std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        format!("{prefix}: access denied — {ADMIN_HINT}")
    } else {
        format!("{prefix}: {e}")
    }
}

// Deserialize is NOT test-only: the elevated plugin install (elevate.rs) reads a
// report back from the child process that produced it.
#[derive(Deserialize, Serialize)]
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

#[derive(Deserialize, Serialize)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_plugin_hints_pin_the_ui_matched_phrases() {
        // `INSTALL_PHRASES` in api/install.ts keys on these substrings to decide
        // which remedy the plugin panel offers for a failed copy. Reword both
        // sides together.
        assert!(PLUGIN_ADMIN_HINT.contains("needs administrator rights"), "{PLUGIN_ADMIN_HINT}");
        assert!(
            PLUGIN_LOCKED_HINT.contains("close every Daz Studio window"),
            "{PLUGIN_LOCKED_HINT}"
        );
        // And the elevated refusal must NOT read as the unelevated one, or the
        // panel offers administrator rights to someone who just used them.
        assert!(!PLUGIN_ELEVATED_DENIED_HINT.contains("needs administrator rights"));
        assert!(!PLUGIN_ELEVATED_DENIED_HINT.contains("close every Daz Studio window"));
    }
}

