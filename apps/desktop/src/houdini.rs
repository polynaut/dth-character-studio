use serde::Deserialize;

/// Open a Houdini project in the GUI and let it run the studio's export job.
///
/// The handoff is entirely through the environment of THIS process: Houdini
/// runs a `456.py` found on `HOUDINI_SCRIPT_PATH` once a scene has loaded, and
/// that script does nothing at all unless `DTH_HOUDINI_JOB` names a job file.
/// Both are set here and nowhere else, so an ordinary Houdini the user starts
/// themselves is untouched.
///
/// GUI rather than headless hython, deliberately: the user wants to watch the
/// exports happen, and the DazToHue HDA's pre-flight dialog exists only in a
/// UI session (456.py answers it and records what it said).
///
/// Fire-and-forget — `spawn`, never `wait`. The export takes minutes and the
/// studio's window must stay live to poll the result file; the process outlives
/// the command. Whether Houdini stays open afterwards is the JOB's decision:
/// with `closeWhenDone` set (the DTH Export flow always sets it), 456.py exits
/// the instance from inside once the final result is written.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchHoudiniJobRequest {
    /// Absolute path of `houdini.exe` (from the Houdini install folder).
    pub houdini_path: String,
    /// The `.hip`/`.hiplc` project to open.
    pub scene_path: String,
    /// The job file 456.py reads (`DTH_HOUDINI_JOB`).
    pub job_path: String,
    /// The value for `HOUDINI_SCRIPT_PATH` — the studio's script folder plus
    /// `&`, composed in TS (`houdiniScriptPathValue`) so the `&` that preserves
    /// Houdini's own default path is covered by a unit test.
    pub script_path: String,
    /// The Houdini user-prefs folder, as HOUDINI_USER_PREF_DIR. Same reason as
    /// `create_houdini_project`: inherited env can resolve the prefs elsewhere,
    /// and then the user's otls — the DazToHue HDA itself — never load, so the
    /// export nodes this job drives would not exist. Empty = inherit.
    pub houdini_pref_dir: String,
}

/// Whether a Houdini GUI is up — the liveness half of the export poll, exactly
/// like `daz_studio_running` is for the Daz batch. A result file stuck at
/// "running" with no Houdini left means the user closed the window (or it
/// crashed) and the poll must stop instead of spinning forever.
///
/// Matches `houdini.exe` and `houdinifx.exe`/`houdinicore.exe` — the licence
/// tier decides the binary name, and the studio must not care which one the
/// user runs.
#[tauri::command(async)]
pub fn houdini_running() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq houdini*", "/NH", "/FO", "CSV"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map(|o| {
                let out = String::from_utf8_lossy(&o.stdout).to_ascii_lowercase();
                ["houdini.exe", "houdinifx.exe", "houdinicore.exe"]
                    .iter()
                    .any(|name| out.contains(name))
            })
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command(async)]
pub fn launch_houdini_job(request: LaunchHoudiniJobRequest) -> Result<(), String> {
    let mut command = std::process::Command::new(&request.houdini_path);
    command.arg(&request.scene_path);
    command.env("DTH_HOUDINI_JOB", &request.job_path);
    command.env("HOUDINI_SCRIPT_PATH", &request.script_path);
    if !request.houdini_pref_dir.is_empty() {
        command.env(
            "HOUDINI_USER_PREF_DIR",
            request.houdini_pref_dir.replace('\\', "/").trim_end_matches('/'),
        );
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Could not start Houdini: {e}"))
}

/// Create a ready-made Houdini project for a character: `hython` starts a
/// fresh scene, bakes `$JOB` to the project folder (`hou.putenv` — the
/// programmatic File → Set Project, saved with the hip), builds the DazToHue
/// network by RUNNING THE DAZTOHUE SHELF TOOL'S OWN SCRIPT, and saves the
/// scene.
///
/// No template scene and no synthetic network on purpose: a template would
/// rot against newer Houdini/DazToHue releases, and a hand-built
/// approximation risks a NON-WORKING network that looks done. The shelf
/// tool's script is the ground truth of what the network is — executing it
/// dynamically tracks every DazToHue release automatically, and when it
/// can't run the scene stays EMPTY (the UI says to add the network from the
/// shelf).
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
    /// JSON `HoudiniPrefill` (built in TS — paths resolved there, per the
    /// convention) applied to the fresh network's nodes: import/CSV/export
    /// paths, character name, skinning. Travels as the `DTH_PREFILL` env var
    /// so no value ever has to be escaped into the Python source. Empty =
    /// prefill nothing.
    pub prefill_json: String,
}

/// Returns `"<created>|<visible>|<prefilled>"`: `Shelf/<tool>` when the shelf
/// tool built the network ('none' when it couldn't — the scene saved empty,
/// `$JOB` still baked), every DazToHue-ish node type hython could see across
/// ALL categories (comma-joined, 'none' when zero) — the UI surfaces the
/// list so a missing network is diagnosable (otls not loading vs the shelf
/// tool failing headless) — and the `node.parm` names the prefill actually
/// set (comma-joined, 'none' when zero: parms missing on an older HDA are
/// skipped one by one, never an error).
#[tauri::command(async)]
pub fn create_houdini_project(request: CreateHoudiniProjectRequest) -> Result<String, String> {
    std::fs::create_dir_all(&request.project_dir)
        .map_err(|e| format!("Could not create the project folder: {e}"))?;
    let escape = |s: &str| s.replace('\\', "/").replace('\'', "\\'");
    // ONE creation strategy: run the DazToHue SHELF TOOL's own script
    // (hou.shelves.tools) — the ground truth of what "the DazToHue network"
    // is (measured on DazToHue 2.x: a geo holding the Import → Skin →
    // Skeleton → … → Export chain), and version-proof by construction (a new
    // DazToHue ships a new tool script, and we execute whatever it says).
    // Deliberately NO synthetic fallback: hand-building an approximation
    // leaves the user with a NON-WORKING network that looks done — when the
    // tool can't run (headless hou.ui touch, tool missing) any half-built
    // nodes are destroyed and the scene saves EMPTY ($JOB still baked); the
    // UI says to add the network from the shelf.
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
            "    tool = None\n",
            "    for name, t in hou.shelves.tools().items():\n",
            "        label = (t.label() or '').lower().replace(' ', '')\n",
            "        if label == 'daztohue' or name.lower() == 'daztohue':\n",
            "            tool = t\n",
            "            break\n",
            "    if tool is not None:\n",
            "        before = set(hou.node('/obj').children())\n",
            "        ok = True\n",
            "        try:\n",
            "            exec(tool.script(), {{'hou': hou, 'kwargs': {{}}}})\n",
            "        except Exception:\n",
            "            ok = False\n",
            "        new = [n for n in hou.node('/obj').children() if n not in before]\n",
            "        if ok and new:\n",
            "            for n in new:\n",
            "                n.moveToGoodPosition()\n",
            "            added = 'Shelf/' + tool.name()\n",
            "        else:\n",
            "            for n in new:\n",
            "                try:\n",
            "                    n.destroy()\n",
            "                except Exception:\n",
            "                    pass\n",
            "except Exception:\n",
            "    added = ''\n",
            // Prefill AFTER the shelf tool built the chain, BEFORE the save, so
            // the wiring lands in the .hip. Per-parm and best-effort: a parm an
            // older HDA doesn't have is skipped (parm() is None), a value the
            // prefill left '' is left alone, and no failure here may ever take
            // down the generation — the network without prefills is still the
            // network. Values arrive via the DTH_PREFILL env var (JSON), never
            // escaped into this source.
            "prefilled = []\n",
            "try:\n",
            "    import json, os\n",
            "    pf = json.loads(os.environ.get('DTH_PREFILL', '') or 'null')\n",
            "    if pf and added:\n",
            "        def set_parm(node, name, value):\n",
            "            if not value:\n",
            "                return\n",
            "            p = node.parm(name)\n",
            "            if p is None:\n",
            "                return\n",
            "            try:\n",
            "                p.set(value)\n",
            "                prefilled.append(node.name() + '.' + name)\n",
            "            except Exception:\n",
            "                pass\n",
            "        for top in new:\n",
            "            for node in [top] + list(top.allSubChildren()):\n",
            "                t = node.type().name().lower()\n",
            "                if 'daztohueimport' in t:\n",
            "                    set_parm(node, 'import_character_name', pf.get('characterName'))\n",
            "                    set_parm(node, 'import_character_dtu_file', pf.get('dth'))\n",
            "                    set_parm(node, 'import_character_fbx_file', pf.get('fbx'))\n",
            "                    set_parm(node, 'import_character_alembic_file', pf.get('abc'))\n",
            "                    set_parm(node, 'import_character_rom_fbx_file', pf.get('romFbx'))\n",
            "                    set_parm(node, 'import_skinning_method', pf.get('skinning'))\n",
            "                elif 'daztohueposeasset' in t:\n",
            "                    set_parm(node, 'pose_asset_csv_file_path', pf.get('csv'))\n",
            "                elif 'daztohueexport' in t and 'groom' not in t:\n",
            "                    set_parm(node, 'export_directory', pf.get('exportDirectory'))\n",
            "except Exception:\n",
            "    pass\n",
            "hou.hipFile.save('{scene}')\n",
            "print('DTH_NETWORK=' + (added or 'none'))\n",
            "print('DTH_TYPES=' + (','.join(visible) or 'none'))\n",
            "print('DTH_PREFILL=' + (','.join(prefilled) or 'none'))\n",
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
    if !request.prefill_json.is_empty() {
        command.env("DTH_PREFILL", &request.prefill_json);
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
    Ok(format!(
        "{}|{}|{}",
        marker("DTH_NETWORK="),
        marker("DTH_TYPES="),
        marker("DTH_PREFILL=")
    ))
}
