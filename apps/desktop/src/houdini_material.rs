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
    /// The Daz surfaces merged into this slot, as the RAW group expressions the
    /// node stores (`@fbx_material_name=Body`) — a G9 skin merges ~15, which is
    /// exactly the hand-work that makes the setup worth copying.
    ///
    /// Raw rather than parsed because these are also the merge rule's input: a
    /// slot is a CLAIM on surfaces, and the panel compares claims verbatim to
    /// preview what a transfer would replace at each target
    /// (`lib/rom/houdini-material-merge.ts`).
    pub surfaces: Vec<String>,
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
    /// The `$JOB` this scene carries — scene state saved with the `.hip`, so a
    /// project keeps whatever it was created with. Read in the SAME pass as the
    /// nodes: opening a `.hip` costs tens of seconds and the Defaults tab must
    /// not pay it twice. Empty only when the project could not be read.
    pub job: String,
    /// The folder the `.hip` sits in — i.e. `$HIP`, which is derived rather
    /// than stored, so it is reported and never rewritten.
    pub hip_dir: String,
    /// What a repath would do to this project's stored file references.
    pub refs: ProjectRefInfo,
}

/// How portable a project's stored file references are.
///
/// Computed by the SAME helpers `repath` runs (in dry mode), so the Defaults
/// tab can never promise a number the action then doesn't deliver.
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRefInfo {
    /// Absolute references that sit under `$HIP` / `$JOB` / `$DAZ3D_LIB` and
    /// can therefore be expressed relative to one of them.
    pub collapsible: u32,
    /// Absolute references under NONE of those roots. They cannot be made
    /// portable, so they are reported rather than silently left looking
    /// handled — the same posture as the material transfer's `foreignPaths`.
    pub foreign: u32,
    /// DazToHue import references whose file is not there, as `<node> <parm>`.
    /// Scoped to those parms on purpose: "the file is missing" is NOT a usable
    /// definition of broken in general — measured, a healthy project reports
    /// four of Houdini's own scratch files (`rendergallery.db`, the PDG
    /// taskgraph/checkpoint) that simply do not exist until used.
    pub broken: Vec<String>,
}

/// One import reference a repath rebuilt.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairedRef {
    /// `<node path> <parm name>`.
    pub label: String,
    #[serde(rename = "from")]
    pub from_path: String,
    #[serde(rename = "to")]
    pub to_path: String,
}

/// What `repath` did (or would do) to one project.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepathResult {
    pub hip_path: String,
    pub ok: bool,
    pub error: String,
    /// References rewritten from an absolute path to a `$VAR`-relative one.
    pub collapsed: u32,
    /// Broken DazToHue import references rebuilt from a sibling that resolved.
    pub repaired: Vec<RepairedRef>,
    /// Absolute references left alone because they sit under no known root.
    pub foreign: Vec<String>,
    /// Where the pre-repath state was backed up (empty for a dry run, and when
    /// nothing needed changing).
    pub backup_path: String,
}

/// What the `defaults` operation did (or would do) to one project's `$JOB`.
///
/// `$JOB` decides whether Houdini's file picker can collapse a chosen path to a
/// variable: a path above `$HIP` collapses only when it sits under `$JOB`. A
/// pre-v0.64 project carries `<char>/houdini/houdini-project`, which is BELOW
/// the exports and so can never help — every hand-picked export came back
/// absolute. Repointing it at the character folder is that migration.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HoudiniDefaultsResult {
    pub hip_path: String,
    pub ok: bool,
    pub error: String,
    /// The `$JOB` the scene carried before the run.
    pub previous_job: String,
    /// The `$JOB` it carries now — for a dry run, what it WOULD carry.
    pub job: String,
    /// false = already correct, so nothing was written. A project on the right
    /// folder is reported and left alone rather than rewritten for nothing.
    pub changed: bool,
    /// Where the pre-repair state was backed up (empty for a dry run, and for
    /// a project that needed no change).
    pub backup_path: String,
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
    /// Target material slots this run removed, by name — the ones whose Daz
    /// surfaces the incoming slots now claim, plus any whose NAME an incoming
    /// slot carries. A surface belongs to exactly one slot, so making room is
    /// part of installing one; empty for the other sections.
    pub evicted: Vec<String>,
    /// Target slots that survived but lost the surfaces that moved — the
    /// partial overlap. Dropping them whole would orphan the surfaces nothing
    /// else claims.
    pub trimmed: Vec<String>,
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
    /// Surfaces the incoming slots claim that NO slot on this target claims
    /// today.
    ///
    /// A few is ordinary — the source wears something the target does not. ALL
    /// of them, on a large set, means the two nodes describe different figures;
    /// copying a Genesis 9 skin onto a Genesis 8 character would look exactly
    /// like this. The studio has NOT measured how the generations name their
    /// surfaces, so this reports the symptom rather than asserting a rule.
    pub unclaimed_surfaces: Vec<String>,
    /// Where the pre-transfer state was backed up (empty for a dry run).
    pub backup_path: String,
}

/// The full report of either operation.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialUtilReport {
    /// `scan`, `transfer`, `defaults` or `repath`.
    pub op: String,
    /// false = the operation itself failed (bad request, source node missing);
    /// per-project and per-target failures are reported in their own `ok`.
    pub ok: bool,
    pub error: String,
    /// Populated by `scan`.
    pub projects: Vec<MaterialScanProject>,
    /// Populated by `transfer`.
    pub targets: Vec<MaterialTransferTarget>,
    /// Populated by `defaults` — one entry per project it was asked about.
    pub defaults: Vec<HoudiniDefaultsResult>,
    /// Populated by `repath` — one entry per project it was asked about.
    pub repath: Vec<RepathResult>,
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
