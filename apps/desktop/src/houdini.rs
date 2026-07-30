use serde::Deserialize;

/// Create a ready-made Houdini project for a character: `hython` starts a
/// fresh scene, bakes `$JOB` to the project folder (`hou.putenv` — the
/// programmatic File → Set Project, saved with the hip), drops in a DazToHue
/// network CREATED FROM THE USER'S INSTALLED HDA, and saves the scene.
///
/// No template scene on purpose: a shipped/user template would rot against
/// newer Houdini builds and newer DazToHue releases. Building the node at
/// generate time always instantiates the CURRENTLY installed DazToHue asset,
/// and the hip is written by the user's own Houdini version. The HDA is
/// discovered among the installed Object-level node types by its core name
/// (exact `daztohue` preferred, else the shortest name containing it — the
/// main asset beats sub-assets like DazToHueImport); when the HDA isn't
/// visible to hython the project still generates with an empty scene and the
/// command reports `false` so the UI can say "add the network from the
/// shelf".
///
/// Path resolution happens in TS (api/houdini.ts); this command only creates
/// the folder and drives hython. `hython -c` keeps it script-file-free; args
/// go through the process API, so no shell quoting is involved — the paths
/// are embedded into the Python snippet with '/' separators and escaped
/// quotes.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHoudiniProjectRequest {
    /// Absolute path of `hython.exe` (from the Houdini install folder).
    pub hython_path: String,
    /// The project folder `$JOB` is baked to (created if missing).
    pub project_dir: String,
    /// The new scene file to save.
    pub scene_path: String,
    /// The Houdini user-prefs folder (Settings' Houdini documents folder,
    /// e.g. `D:/Documents/houdini22.0`) — set as HOUDINI_USER_PREF_DIR on the
    /// hython process. Load-bearing: hython inherits the STUDIO's environment,
    /// and a wrong HOME/pref resolution means the user's otls (the DazToHue
    /// HDA!) never load — the same leak that hid the DazToHue shelf from
    /// studio-launched Houdini. Empty = inherit (no override).
    pub houdini_pref_dir: String,
}

/// Returns `"<created>|<visible>"`: the created node type ('none' when the
/// HDA wasn't found — the scene saved empty, `$JOB` still baked), and every
/// DazToHue-ish node type hython could see across ALL categories
/// (comma-joined, 'none' when zero) — the UI surfaces the list so a missing
/// network is diagnosable (otls not loading vs the main asset living at an
/// unexpected level).
#[tauri::command(async)]
pub fn create_houdini_project(request: CreateHoudiniProjectRequest) -> Result<String, String> {
    std::fs::create_dir_all(&request.project_dir)
        .map_err(|e| format!("Could not create the project folder: {e}"))?;
    let escape = |s: &str| s.replace('\\', "/").replace('\'', "\\'");
    let python = format!(
        concat!(
            "import hou\n",
            "hou.hipFile.clear(suppress_save_prompt=True)\n",
            "hou.putenv('JOB', '{job}')\n",
            "added = ''\n",
            "visible = []\n",
            "try:\n",
            "    for cat in hou.nodeTypeCategories().values():\n",
            "        for name, t in cat.nodeTypes().items():\n",
            "            if 'daztohue' in t.nameComponents()[2].lower():\n",
            "                visible.append(cat.name() + '/' + t.name())\n",
            "    best = None\n",
            "    best_key = None\n",
            "    for name, t in hou.objNodeTypeCategory().nodeTypes().items():\n",
            "        core = t.nameComponents()[2].lower()\n",
            "        if 'daztohue' not in core:\n",
            "            continue\n",
            "        key = (0 if core == 'daztohue' else 1, len(core))\n",
            "        if best is None or key < best_key:\n",
            "            best, best_key = t, key\n",
            "    if best is not None:\n",
            "        node = hou.node('/obj').createNode(best.name())\n",
            "        node.moveToGoodPosition()\n",
            "        added = best.name()\n",
            "except Exception:\n",
            "    added = ''\n",
            "hou.hipFile.save('{scene}')\n",
            "print('DTH_NETWORK=' + (added or 'none'))\n",
            "print('DTH_TYPES=' + (','.join(visible) or 'none'))\n",
        ),
        job = escape(&request.project_dir),
        scene = escape(&request.scene_path),
    );
    let mut command = std::process::Command::new(&request.hython_path);
    command.arg("-c").arg(python);
    if !request.houdini_pref_dir.is_empty() {
        // Point hython at the REAL user prefs (otls, packages, houdini.env) —
        // inherited env can resolve them elsewhere (see the struct docs).
        command.env(
            "HOUDINI_USER_PREF_DIR",
            request.houdini_pref_dir.replace('\\', "/").trim_end_matches('/'),
        );
    }
    let output = command
        .output()
        .map_err(|e| format!("Could not start hython: {e}"))?;
    if !output.status.success() {
        // hython's stderr ends with the actual Python error — surface its tail.
        let stderr = String::from_utf8_lossy(&output.stderr);
        let lines: Vec<&str> = stderr.lines().filter(|l| !l.trim().is_empty()).collect();
        let tail = lines
            .iter()
            .rev()
            .take(6)
            .rev()
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(if tail.is_empty() {
            format!("hython exited with {}", output.status)
        } else {
            tail
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let marker = |prefix: &str| {
        stdout
            .lines()
            .rev()
            .find_map(|line| line.trim().strip_prefix(prefix).map(str::to_string))
            .unwrap_or_else(|| "none".to_string())
    };
    Ok(format!("{}|{}", marker("DTH_NETWORK="), marker("DTH_TYPES=")))
}
