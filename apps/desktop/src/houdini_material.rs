//! DazToHue material utilities — the native half of the studio's "Utils" panel.
//!
//! Drives `material_utils.py` under `hython` to scan a set of `.hip` files for
//! DazToHueMaterial nodes, and to copy one node's texture-baker definitions onto
//! others. This command is a PROCESS RUNNER plus a typed boundary: everything
//! about what a baker is lives in the Python (it needs `hou` to read a node at
//! all), and everything about paths lives in TS (api/houdini-material.ts) —
//! the same split as `create_houdini_project`.
//!
//! The handoff is a request file in / a result file out rather than stdout: the
//! payload carries user paths and material names, and Houdini writes plenty of
//! its own noise to stdout that would have to be separated back out.
//!
//! The report is deserialized into the structs below instead of being passed
//! through as an opaque string, so a Python-side shape change fails HERE rather
//! than somewhere in the UI. The wire format is pinned by
//! `contracts/material-util-report.json` (round-tripped in `contract_tests.rs`,
//! parsed by the matching zod schema in `native-contract.test.ts`).

use serde::{Deserialize, Serialize};

/// One DazToHueMaterial node found by a scan.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialNodeInfo {
    /// Full node path inside the scene, e.g. `/obj/DazToHue/DazToHueMaterial`.
    pub path: String,
    /// The node's own name (`DazToHueMaterial`, `DazToHueMaterial1`, …).
    pub name: String,
    /// Title of the network box the node sits in, or empty.
    ///
    /// A project with several DTH networks wraps each in a titled box
    /// (`KiraDefault`, `KiraYoga`, `KiraNaked`) — the only human-meaningful
    /// name the setup has, so the panel labels nodes by this when present.
    /// Measured: the visible title is the box's COMMENT, not its name.
    pub network_box: String,
    /// Material slots defined on the node (the Materials tab).
    pub materials: u32,
    /// UV channels defined (the UVs tab).
    pub uv_channels: u32,
    /// Texture bakers defined (the Texture Baking tab).
    pub bakers: u32,
    /// Total baker LAYERS across those bakers — the real measure of how much
    /// hand-work a setup represents.
    pub layers: u32,
    /// Each baker's name, in order (`T_Skin_Colour`, …).
    pub baker_names: Vec<String>,
    /// Every material slot name, with and without the node's prefix — used to
    /// tell whether a transferred baker's material exists here.
    pub material_names: Vec<String>,
}

/// One scanned `.hip` file.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialScanProject {
    pub hip_path: String,
    /// false = the project could not be opened (missing, locked, corrupt);
    /// `error` says why and `nodes` is empty. One bad file never fails the scan.
    pub ok: bool,
    pub error: String,
    pub nodes: Vec<MaterialNodeInfo>,
}

/// What a transfer did (or, in a dry run, would do) to one target node.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialTransferTarget {
    pub hip_path: String,
    pub node_path: String,
    pub ok: bool,
    pub error: String,
    pub bakers_before: u32,
    pub bakers_after: u32,
    /// Names of the bakers copied in.
    pub added: Vec<String>,
    /// Whether the target's existing bakers were replaced rather than appended.
    pub replaced: bool,
    /// Materials the copied bakers reference that this target does NOT define.
    /// A baker with an unknown material imports fine and then bakes nothing —
    /// so this is the difference between a real copy and a cosmetic one.
    pub missing_materials: Vec<String>,
    /// Geometry groups the copied layers reference that the target's cooked
    /// geometry does not have. Empty ALSO means "could not be checked" (no
    /// cooked geometry in a headless session) — never read it as "all present".
    pub missing_groups: Vec<String>,
    /// Where the pre-transfer state was backed up (empty for a dry run).
    pub backup_path: String,
}

/// The full report of either operation.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialUtilReport {
    /// `scan` or `transfer`.
    pub op: String,
    /// false = the operation itself failed (bad request, source node missing);
    /// per-project and per-target failures are reported in their own `ok`.
    pub ok: bool,
    pub error: String,
    /// Populated by `scan`.
    pub projects: Vec<MaterialScanProject>,
    /// Populated by `transfer`.
    pub targets: Vec<MaterialTransferTarget>,
    pub source_bakers: u32,
    pub source_layers: u32,
    pub source_baker_names: Vec<String>,
    pub dry_run: bool,
    pub replace: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialUtilRequest {
    /// Absolute path of `hython.exe` (from the Houdini install folder).
    pub hython_path: String,
    /// `material_utils.py`, written into app-data by the caller before each run
    /// (self-repairing, like `456.py` — no install ritual, always current).
    pub script_path: String,
    /// The JSON request file the script reads.
    pub request_path: String,
    /// The JSON result file the script writes.
    pub result_path: String,
    /// HOUDINI_USER_PREF_DIR for the hython process. Load-bearing for the same
    /// reason as `create_houdini_project`: inherited env can resolve the prefs
    /// elsewhere, and then the DazToHue otls never load — every node would
    /// come back as an unknown type. Empty = inherit.
    pub houdini_pref_dir: String,
}

/// Run one material-utility operation and return its typed report.
///
/// Blocking (`output()`, not `spawn`): opening a `.hip` takes tens of seconds
/// and the caller has nothing to do until the report exists. `#[tauri::command(async)]`
/// keeps that off the main thread.
#[tauri::command(async)]
pub fn run_houdini_material_util(
    request: MaterialUtilRequest,
) -> Result<MaterialUtilReport, String> {
    // A result file from an earlier run must never be read as this run's answer.
    let _ = std::fs::remove_file(&request.result_path);

    let mut command = std::process::Command::new(&request.hython_path);
    command
        .arg(&request.script_path)
        .arg(&request.request_path)
        .arg(&request.result_path);
    if !request.houdini_pref_dir.is_empty() {
        command.env(
            "HOUDINI_USER_PREF_DIR",
            request.houdini_pref_dir.replace('\\', "/").trim_end_matches('/'),
        );
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = command
        .output()
        .map_err(|e| format!("Could not start hython: {e}"))?;

    // The script writes its result file even for a handled failure, so a
    // readable report is preferred over the exit status: it carries the precise
    // per-project/per-target reason. Only when there is NO report does the
    // process failure itself become the error.
    let report = std::fs::read_to_string(&request.result_path).ok();
    let Some(text) = report else {
        // Report BOTH streams: a script that fails loudly leaves a traceback on
        // stderr, but the nastier case is a process that exits 0 having written
        // nothing — there the only clue is whatever it printed, and an error
        // saying just "exited with exit code: 0" sends the reader nowhere.
        let tail = |bytes: &[u8]| {
            let text = String::from_utf8_lossy(bytes).into_owned();
            let lines: Vec<String> = text
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(str::to_string)
                .collect();
            lines
                .iter()
                .rev()
                .take(8)
                .rev()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n")
        };
        let err_tail = tail(&output.stderr);
        let out_tail = tail(&output.stdout);
        let mut message = format!(
            "hython exited with {} but wrote no report:\n{}",
            output.status, request.result_path
        );
        if !err_tail.is_empty() {
            message.push_str(&format!("\n\nstderr:\n{err_tail}"));
        }
        if !out_tail.is_empty() {
            message.push_str(&format!("\n\nstdout:\n{out_tail}"));
        }
        return Err(message);
    };

    serde_json::from_str::<MaterialUtilReport>(&text)
        .map_err(|e| format!("Could not read the material report: {e}"))
}
