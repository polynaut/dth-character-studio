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

/// One material slot on a node, with the bakers that name it.
///
/// The unit a user actually reuses is a MATERIAL — "the same skin", "that one
/// dress" — so the panel picks slots, and a slot's bakers travel with it.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialSlotInfo {
    /// Slot name as stored (`Skin`).
    pub name: String,
    /// Name as a baker spells it, i.e. with the node's prefix (`MI_Skin`).
    pub display_name: String,
    /// Daz surfaces merged into this slot — a G9 skin merges ~15, which is
    /// exactly the hand-work that makes the setup worth copying.
    pub surfaces: u32,
    pub bakers: u32,
    pub layers: u32,
    /// UV names this slot's bakers read that only a UV CHANNEL produces
    /// (`uv_geoshell`). EMPTY means the material copies fine without the
    /// channels — measured: clothing reads only `uv_original`, skin does not.
    pub channel_uvs: Vec<String>,
}

/// How much is configured in one section of a node (the skeleton node's tabs).
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionCountInfo {
    pub key: String,
    /// Human label as the HDA spells it ("Skin Weights").
    pub label: String,
    /// Non-default settings plus list entries — "how much was changed here",
    /// which is what a user recognises; a raw parm count reads the same for an
    /// untouched node and a heavily configured one.
    pub count: u32,
}

/// One DazToHue node found by a scan (a material or a skeleton node).
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialNodeInfo {
    /// Full node path inside the scene, e.g. `/obj/DazToHue/DazToHueMaterial`.
    pub path: String,
    /// The node's own name (`DazToHueMaterial`, `DazToHueMaterial1`, …).
    pub name: String,
    /// Which panel tab owns this node: `material` or `skeleton`. ONE scan
    /// returns both kinds — opening a `.hip` costs tens of seconds, so
    /// switching tab must not pay it again.
    pub node_type: String,
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
    /// The node's material slots, each with its bakers — the panel's pick list.
    /// Empty for a skeleton node.
    pub slots: Vec<MaterialSlotInfo>,
    /// Per-section "how much is set here" — the skeleton node's tabs. Empty for
    /// a material node, which reports its own counts in the fields above.
    pub section_counts: Vec<SectionCountInfo>,
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

/// What one transferred section did to a target node.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialSectionResult {
    /// `materials`, `uvChannels` or `bakers`.
    pub key: String,
    /// Instance count before and after (for a dry run, what it WOULD become).
    pub before: u32,
    pub after: u32,
    /// Instances an append skipped because the target already defines that name
    /// — material slots only, where two slots claiming the same surfaces would
    /// be worse than not copying.
    pub skipped: u32,
}

/// What a transfer did (or, in a dry run, would do) to one target node.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialTransferTarget {
    pub hip_path: String,
    pub node_path: String,
    pub ok: bool,
    pub error: String,
    /// One entry per transferred section, in the order they were applied.
    pub sections: Vec<MaterialSectionResult>,
    /// Names of the bakers copied in.
    pub added: Vec<String>,
    /// Whether the target's existing bakers were replaced rather than appended.
    pub replaced: bool,
    /// Materials the copied bakers reference that this target will STILL not
    /// define once the run finishes — i.e. computed against the target's own
    /// slots PLUS whatever the `materials` section installs. A baker with an
    /// unknown material imports fine and then bakes nothing, so this is the
    /// difference between a real copy and a cosmetic one, and it is what the
    /// user has to set up by hand before the bakers land.
    pub missing_materials: Vec<String>,
    /// Geometry groups the copied layers reference that the target's cooked
    /// geometry does not have. Empty ALSO means "could not be checked" (no
    /// cooked geometry in a headless session) — never read it as "all present".
    pub missing_groups: Vec<String>,
    /// UV names the copied bakers read that only a UV channel produces, when
    /// the channels are NOT part of this run — so "do I need the UV channels
    /// too?" is answered instead of guessed. Empty for a clothing material.
    pub missing_uv_sources: Vec<String>,
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
    /// The sections this run was asked to transfer.
    pub sections: Vec<String>,
    /// The material slot names it was restricted to (empty = all).
    pub materials: Vec<String>,
    /// Whether Daz-library texture paths were pointed at `$DAZ3D_LIB`.
    pub use_lib_var: bool,
    /// How many paths that rewrite touched.
    pub rewritten_paths: u32,
    /// Absolute paths left alone because they live OUTSIDE the Daz library —
    /// they cannot be made portable, so the user is told which stayed pinned.
    pub foreign_paths: Vec<String>,
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
