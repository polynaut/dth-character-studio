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
/// programmatic File → Set Project, saved with the hip), puts the timeline on
/// the pipeline's FPS (`hou.setFps` — see `fps` below for why this is the
/// studio's job here and nowhere else), builds the DazToHue network by RUNNING
/// THE DAZTOHUE SHELF TOOL'S OWN SCRIPT, and saves the scene.
///
/// No template scene and no synthetic network on purpose: a template would
/// rot against newer Houdini/DazToHue releases, and a hand-built
/// approximation risks a NON-WORKING network that looks done. The shelf
/// tool's script is the ground truth of what the network is — executing it
/// dynamically tracks every DazToHue release automatically, and when it
/// can't run the scene stays EMPTY (the UI says to add the network from the
/// shelf).
///
/// Path resolution happens in TS (api/houdini.ts); this command only drives
/// hython. `hython -c` keeps it script-file-free; args
/// go through the process API, so no shell quoting is involved — the paths
/// are embedded into the Python snippet with '/' separators and escaped
/// quotes.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHoudiniProjectRequest {
    /// Absolute path of `hython.exe` (from the Houdini install folder).
    pub hython_path: String,
    /// The folder `$JOB` is baked to: the CHARACTER folder.
    ///
    /// Measured with `hou.text.collapseCommonVars` (what the file picker uses to
    /// turn a chosen path back into a variable): a path above `$HIP` collapses
    /// only if it is under `$JOB`. With `$JOB` at the old
    /// `houdini/houdini-project`, picking an export gave an ABSOLUTE path and
    /// the project stopped being movable — the retired `dth-exports` junction
    /// had been hiding that by making exports appear below `$HIP`. With `$JOB`
    /// at the character folder, the same pick collapses instead of going
    /// absolute — and since v0.68 put `daz-export` INSIDE the houdini folder it
    /// lands as `$HIP/daz-export/…` (`$HIP` wins for anything under it,
    /// re-measured 2026-08-10), leaving `$JOB` for what sits beside it, such as
    /// `<char>/export`. Both need `$JOB` baked here: it is what makes the
    /// second form expressible at all.
    pub job_dir: String,
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
    /// The timeline FPS to bake into the new scene — the pipeline's 30
    /// (`DTH_FPS` in `lib/rom/houdini-defaults.ts`, which is the ONE place the
    /// studio states it). 0 = leave Houdini's default alone.
    ///
    /// Why the studio sets it at all, when DazToHue's import node does it
    /// itself: per mrpdean, that node sets the FPS *when it loads the files* —
    /// and nothing loads a file here. hython instantiates the network and sets
    /// its parms directly, so the trigger never fires and the scene would be
    /// saved on Houdini's own 24 while the ROM it is wired to is 30.
    pub fps: f64,
}

/// Returns `"<created>|<visible>|<prefilled>|<fps>"`: `Shelf/<tool>` when the
/// shelf tool built the network ('none' when it couldn't — the scene saved
/// empty, `$JOB` still baked), every DazToHue-ish node type hython could see
/// across ALL categories (comma-joined, 'none' when zero) — the UI surfaces the
/// list so a missing network is diagnosable (otls not loading vs the shelf
/// tool failing headless) — the `node.parm` names the prefill actually
/// set (comma-joined, 'none' when zero: parms missing on an older HDA are
/// skipped one by one, never an error), and the FPS the saved scene ACTUALLY
/// carries, read back off `hou.fps()` rather than echoing the request ('none'
/// when hython could not answer).
#[tauri::command(async)]
pub fn create_houdini_project(request: CreateHoudiniProjectRequest) -> Result<String, String> {
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
            // The timeline, BEFORE the network is built: the scene is empty
            // here, so there is not a keyframe in it for `setFps` to re-time —
            // whatever it would do to an existing animation cannot apply. Read
            // back rather than assumed, so what the UI reports is the scene's
            // own answer and not the number we asked for — and read back in its
            // OWN try, so a Houdini that refuses the set still reports the rate
            // the scene really carries (which is what makes the UI warn)
            // instead of collapsing to 0 = unknown.
            "scene_fps = 0.0\n",
            "try:\n",
            "    if {fps} > 0:\n",
            "        hou.setFps({fps})\n",
            "except Exception:\n",
            "    pass\n",
            "try:\n",
            "    scene_fps = float(hou.fps())\n",
            "except Exception:\n",
            "    scene_fps = 0.0\n",
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
            "print('DTH_FPS=' + str(scene_fps))\n",
        ),
        job = escape(&request.job_dir),
        scene = escape(&request.scene_path),
        fps = request.fps,
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
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Without this, hython opens a console window that takes FOCUS — in the
        // middle of a Generate the user is watching, on top of the dialog that
        // started it. `run_houdini_material_util` has always suppressed it; this
        // spawn simply never did.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
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
        "{}|{}|{}|{}",
        marker("DTH_NETWORK="),
        marker("DTH_TYPES="),
        marker("DTH_PREFILL="),
        marker("DTH_FPS=")
    ))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveDirIfEmptyRequest {
    /// The folder to retire. Removed ONLY when it is empty.
    pub dir_path: String,
}

/// Remove a leftover folder — but only when it holds nothing.
///
/// The sweep behind the retired `houdini-project` folder (v0.68). That folder
/// was created as the shared "project folder" every generated scene would
/// `Set Project` to, which could never do what it promised: Houdini writes its
/// own output (render/, geo/, backup/) relative to `$HIP`, and `$HIP` is
/// DERIVED from where the `.hip` sits — `Set Project` sets `$JOB`, not `$HIP`.
/// So the output landed beside the scenes and this folder stayed empty.
///
/// **Empty is the whole safety rail.** A pre-v0.64 project DID have `$JOB`
/// pointed here, so Houdini may have written real caches or renders into it —
/// user output the studio has no business deleting. `std::fs::remove_dir`
/// refuses a non-empty directory by itself; the explicit read_dir check is
/// there to report `"not-empty"` as a normal outcome rather than an error, so
/// the caller can tell the user what it left behind.
///
/// Returns `"removed"`, `"absent"` (nothing there), `"not-empty"` (left alone,
/// deliberately not an error) or `"not-a-directory"` (a file — or a reparse
/// point, which is never followed — sits at that path).
// `(async)`: the folder can live on an offline NAS share, where the stat/read/
// remove block for seconds — and the sweep runs per linked scene during
// generation.
#[tauri::command(async)]
pub fn remove_dir_if_empty(request: RemoveDirIfEmptyRequest) -> Result<String, String> {
    let dir = std::path::Path::new(&request.dir_path);
    // symlink_metadata, not metadata: a junction/symlink must NOT be followed —
    // removing one here could look "empty" while its target holds everything.
    let Ok(meta) = std::fs::symlink_metadata(dir) else {
        return Ok("absent".into());
    };
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Ok("not-a-directory".into());
    }
    let mut entries =
        std::fs::read_dir(dir).map_err(|e| format!("Could not read the folder: {e}"))?;
    if entries.next().is_some() {
        return Ok("not-empty".into());
    }
    std::fs::remove_dir(dir).map_err(|e| format!("Could not remove the folder: {e}"))?;
    Ok("removed".into())
}

#[cfg(test)]
mod remove_dir_if_empty_tests {
    use super::*;

    fn request(dir: &std::path::Path) -> RemoveDirIfEmptyRequest {
        RemoveDirIfEmptyRequest {
            dir_path: dir.to_string_lossy().into_owned(),
        }
    }

    #[test]
    fn removes_an_empty_folder() {
        let temp = std::env::temp_dir().join("dth_rmdir_empty");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).unwrap();
        assert_eq!(remove_dir_if_empty(request(&temp)).unwrap(), "removed");
        assert!(!temp.exists());
    }

    #[test]
    fn absent_is_not_an_error() {
        let temp = std::env::temp_dir().join("dth_rmdir_absent");
        let _ = std::fs::remove_dir_all(&temp);
        assert_eq!(remove_dir_if_empty(request(&temp)).unwrap(), "absent");
    }

    /// The one that matters: a `houdini-project` holding a pre-v0.64 project's
    /// caches is the user's own output and must survive the sweep untouched.
    #[test]
    fn refuses_a_folder_with_anything_in_it() {
        let temp = std::env::temp_dir().join("dth_rmdir_full");
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(temp.join("geo")).unwrap();
        std::fs::write(temp.join("geo").join("cache.bgeo"), b"x").unwrap();
        assert_eq!(remove_dir_if_empty(request(&temp)).unwrap(), "not-empty");
        assert!(temp.join("geo").join("cache.bgeo").exists());
        std::fs::remove_dir_all(&temp).unwrap();
    }

    #[test]
    fn refuses_a_file() {
        let temp = std::env::temp_dir().join("dth_rmdir_file");
        let _ = std::fs::remove_file(&temp);
        std::fs::write(&temp, b"x").unwrap();
        assert_eq!(remove_dir_if_empty(request(&temp)).unwrap(), "not-a-directory");
        assert!(temp.exists());
        std::fs::remove_file(&temp).unwrap();
    }

    /// The data-loss vector the symlink_metadata guard exists for: a link named
    /// `houdini-project` must be refused UNFOLLOWED — through the link its
    /// (empty-looking or full) target could be judged, and the link's removal
    /// semantics differ per platform. Unix-only: creating a Windows junction
    /// needs elevation/mklink, but the guard is the same `is_symlink()` branch.
    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_without_following_it() {
        let root = std::env::temp_dir().join("dth_rmdir_symlink");
        let _ = std::fs::remove_dir_all(&root);
        let target = root.join("target");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("keep.txt"), b"x").unwrap();
        let link = root.join("houdini-project");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert_eq!(remove_dir_if_empty(request(&link)).unwrap(), "not-a-directory");
        assert!(link.exists(), "the link itself must survive");
        assert!(target.join("keep.txt").exists(), "the target must be untouched");
        std::fs::remove_dir_all(&root).unwrap();
    }
}
