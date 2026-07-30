use serde::Deserialize;

/// Create a ready-made Houdini project for a character: load the user's
/// DazToHue template scene in `hython`, bake `$JOB` to the project folder
/// (`hou.putenv` — the programmatic File → Set Project, saved with the hip)
/// and save it as the new project's scene. Path resolution happens in TS
/// (api/houdini.ts); this command only creates the folder and drives hython.
/// `hython -c` keeps it script-file-free; args go through the process API, so
/// no shell quoting is involved — the paths are embedded into the Python
/// snippet with '/' separators and escaped quotes.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateHoudiniProjectRequest {
    /// Absolute path of `hython.exe` (from the Houdini install folder).
    pub hython_path: String,
    /// The template `.hip`/`.hiplc` with the prepared DazToHue network.
    pub template_path: String,
    /// The project folder `$JOB` is baked to (created if missing).
    pub project_dir: String,
    /// The new scene file to save (inside the project folder).
    pub scene_path: String,
}

#[tauri::command(async)]
pub fn create_houdini_project(request: CreateHoudiniProjectRequest) -> Result<(), String> {
    std::fs::create_dir_all(&request.project_dir)
        .map_err(|e| format!("Could not create the project folder: {e}"))?;
    let escape = |s: &str| s.replace('\\', "/").replace('\'', "\\'");
    let python = format!(
        "import hou\nhou.hipFile.load('{}', suppress_save_prompt=True, ignore_load_warnings=True)\nhou.putenv('JOB', '{}')\nhou.hipFile.save('{}')\n",
        escape(&request.template_path),
        escape(&request.project_dir),
        escape(&request.scene_path),
    );
    let output = std::process::Command::new(&request.hython_path)
        .arg("-c")
        .arg(python)
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
    Ok(())
}
