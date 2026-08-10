// --- Daz Studio process probe + script bridge --------------------------------

/// The image name every Daz Studio ships, whatever its major version — which is
/// exactly why a name alone can't identify an INSTALLATION (see
/// `daz_studio_running`).
#[cfg(windows)]
const DAZ_EXE: &str = "DAZStudio.exe";

/// Whether a Daz Studio instance is currently running.
///
/// `install_folder` is the question's SCOPE, and empty means "any Daz":
///
/// - **empty** — any running Daz counts. What the scene-open bridge asks: a
///   running Daz (DS6) silently ignores forwarded `.duf` opens, but forwarded
///   SCRIPT files still execute, so the studio opens scenes through a one-shot
///   `.dsa` when an instance is up (see `run_daz_script`).
/// - **a folder** — only an instance started FROM that folder counts. What the
///   export/scan handoff asks, because DS4 and DS6 both run `DAZStudio.exe`:
///   with "Export only" pointing at the older install, an open DS6 made the
///   global probe answer "Daz is already running, nothing to launch" and the
///   batch meant for the OTHER install was never started at all (the job file
///   sat pending and unclaimed forever). Both installs are Daz; only one of
///   them is the one the batch needs.
///
/// A running instance whose executable path can't be read (elevated Daz, an
/// unelevated studio) counts as a match for ANY folder: unknown must not read
/// as "not yours" here, because the callers that ask about a specific install
/// include the export watch, which DELETES the job file of a run it believes is
/// dead. Over-reporting costs a redundant launch that Daz itself collapses into
/// the running instance; under-reporting would strand a live batch.
// `(async)`: enumerates processes and queries their image paths — off the main
// thread, like every other probe here.
#[tauri::command(async)]
pub fn daz_studio_running(install_folder: String) -> bool {
    #[cfg(windows)]
    {
        let running = crate::procs::running_exe_paths(DAZ_EXE);
        if install_folder.trim().is_empty() {
            return !running.is_empty();
        }
        running
            .iter()
            .any(|exe| exe.as_deref().is_none_or(|path| exe_started_from(path, &install_folder)))
    }
    #[cfg(not(windows))]
    {
        let _ = install_folder;
        false
    }
}

/// Whether the executable at `exe` was started from `folder` — the test that
/// tells a running DS4 from a running DS6 when both are `DAZStudio.exe`.
///
/// Compares on a normalized path AND on a component boundary: `DAZStudio4` must
/// never match an install in `DAZStudio40` (`.ai/gotchas.md` — a path-ordered
/// decision compares per component, never by bare prefix). An empty folder is no
/// question, so nothing matches it; callers handle "any Daz" before getting here.
#[cfg(windows)]
fn exe_started_from(exe: &str, folder: &str) -> bool {
    let folder = normalize_path(folder);
    if folder.is_empty() {
        return false;
    }
    normalize_path(exe)
        .strip_prefix(&folder)
        .is_some_and(|rest| rest.starts_with('\\'))
}

/// A Windows path in one spelling: lowercase, backslash separators, no trailing
/// separator — so `C:/Program Files/DAZ 3D/DAZStudio6/` and
/// `C:\Program Files\DAZ 3D\DAZStudio6` compare equal. (Settings stores the
/// folder with forward slashes; the OS reports the running exe with backslashes.)
#[cfg(windows)]
fn normalize_path(path: &str) -> String {
    path.trim()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

/// Run a Daz Studio script (`.dsa`) by launching Daz's executable directly with
/// the script as its argument — `DAZStudio.exe "<script>"`. When an instance is
/// already up, Daz forwards the script to it and runs it there; otherwise it
/// starts fresh and runs it. This deliberately does NOT shell-open the `.dsa`
/// (the old approach): a shell-open uses the OS file association, and on a dev
/// machine `.dsa` is often bound to a text editor (VS Code), so the script would
/// open as text and never execute. Launching the exe is association-independent.
///
/// We use the RUNNING instance's own executable path so the script forwards to
/// the instance the user is looking at — DS4 and DS6 are separate single-instance
/// apps, so a DS6 exe can't forward into a running DS4 (it would spawn a second
/// DS6). Falls back to a standard install-dir probe only if the running instance
/// can't be located.
/// Returns the executable it launched (so the caller can log which instance it
/// targeted — useful when debugging why a running Daz did or didn't react).
// `(async)`: the running-instance probe shells out to PowerShell (a CIM query
// takes noticeable time) — off the main thread.
#[tauri::command(async)]
pub fn run_daz_script(script_path: String, install_folder: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let exe = running_daz_exe()
            .or_else(|| installed_daz_exe(&install_folder))
            .ok_or_else(|| "Could not locate the Daz Studio executable.".to_string())?;
        std::process::Command::new(&exe)
            .arg(&script_path)
            .spawn()
            .map_err(|e| format!("Failed to launch Daz Studio ({exe}): {e}"))?;
        Ok(exe)
    }
    #[cfg(not(windows))]
    {
        let _ = (script_path, install_folder);
        Err("Running a Daz script is only supported on Windows.".to_string())
    }
}

/// Launch Daz Studio — with the scene as its one argument when `scenePath` is
/// non-empty, else a plain scene-less startup. Used by
/// the Execute feature: the studio writes the exporter job file first, then
/// starts Daz so the DTH Exporter Plugin finds and runs the jobs on startup.
/// The caller is expected to check `daz_studio_running` first — launching while
/// an instance is up only forwards to it (no fresh startup, so the plugin's
/// startup job check never fires there).
/// Returns the executable it launched (for logging, like `run_daz_script`).
///
/// **The requested installation wins over whatever happens to be running.** The
/// caller names the install it wants (the activated one; the "Export only" one
/// for a batch handoff), and preferring a running instance over it meant a live
/// DS6 hijacked a launch aimed at DS4 — the same install-blindness that made
/// `daz_studio_running` skip the launch in the first place. The running
/// instance is still the answer when the caller names NO folder (a user who has
/// activated nothing), and the standard-locations probe stays the last resort.
// `(async)`: the running-instance/install probes enumerate processes and touch
// the filesystem — off the main thread.
#[tauri::command(async)]
pub fn launch_daz_studio(install_folder: String, scene_path: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let exe = exe_in_folder(&install_folder)
            .or_else(running_daz_exe)
            .or_else(probe_daz_exe)
            .ok_or_else(|| "Could not locate the Daz Studio executable.".to_string())?;
        let mut command = std::process::Command::new(&exe);
        // A scene, when the caller has one: `DAZStudio.exe "<scene>"` is how a
        // fresh instance opens it, and it is ASSOCIATION-INDEPENDENT — unlike a
        // shell-open, which hands the .duf to whichever Daz registered the file
        // type last and so ignores the activated installation entirely.
        if !scene_path.is_empty() {
            command.arg(&scene_path);
        }
        command
            .spawn()
            .map_err(|e| format!("Failed to launch Daz Studio ({exe}): {e}"))?;
        Ok(exe)
    }
    #[cfg(not(windows))]
    {
        let _ = (install_folder, scene_path);
        Err("Launching Daz Studio is only supported on Windows.".to_string())
    }
}

/// Full path to the executable of a currently-running `DAZStudio.exe` — the
/// first one found when several are up (DS4 and DS6 can run side by side).
/// `None` if no Daz is running or no path could be read.
///
/// Read from a ToolHelp snapshot, not a `Get-CimInstance` child process: the
/// same call now answers `daz_studio_running`, which sits in one-second UI
/// polls where a PowerShell spawn per tick would be felt.
#[cfg(windows)]
fn running_daz_exe() -> Option<String> {
    crate::procs::running_exe_paths(DAZ_EXE).into_iter().flatten().next()
}

/// `<folder>/DAZStudio.exe` when that is a real file — the executable an
/// explicitly named installation runs. `None` for an empty folder (nothing was
/// asked for) or one that has moved.
#[cfg(windows)]
fn exe_in_folder(folder: &str) -> Option<String> {
    if folder.trim().is_empty() {
        return None;
    }
    let exe = std::path::Path::new(folder.trim()).join("DAZStudio.exe");
    if !exe.is_file() {
        return None;
    }
    exe.to_str().map(str::to_string)
}

/// Best-effort probe of the standard Daz install locations (newest first). A
/// guess, and only ever reached when the user has expressed none — an activated
/// installation, or a running instance, both outrank it.
#[cfg(windows)]
fn probe_daz_exe() -> Option<String> {
    for var in ["PROGRAMFILES", "ProgramFiles(x86)"] {
        let Ok(base) = std::env::var(var) else { continue };
        for ver in ["DAZStudio6", "DAZStudio4"] {
            let exe = std::path::Path::new(&base)
                .join("DAZ 3D")
                .join(ver)
                .join("DAZStudio.exe");
            if exe.is_file() {
                return exe.to_str().map(str::to_string);
            }
        }
    }
    None
}

/// The ACTIVATED installation, else the standard-locations probe. Without the
/// first half the probe's hardcoded order decides, so a machine with both
/// installed could never reach DAZStudio4 no matter what Settings said — while
/// the Exporter plugin was being installed into the one the user activated.
#[cfg(windows)]
fn installed_daz_exe(preferred: &str) -> Option<String> {
    exe_in_folder(preferred).or_else(probe_daz_exe)
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    // The bug these pin: DS4 and DS6 both run an executable named
    // `DAZStudio.exe`, so "which install is running" can only be answered from
    // the full path.
    #[test]
    fn matches_the_install_the_exe_was_started_from() {
        let ds4 = r"C:\Program Files\DAZ 3D\DAZStudio4\DAZStudio.exe";
        let ds6 = r"C:\Program Files\DAZ 3D\DAZStudio6\DAZStudio.exe";
        assert!(exe_started_from(ds4, r"C:\Program Files\DAZ 3D\DAZStudio4"));
        assert!(!exe_started_from(ds6, r"C:\Program Files\DAZ 3D\DAZStudio4"));
        assert!(exe_started_from(ds6, r"C:\Program Files\DAZ 3D\DAZStudio6"));
    }

    #[test]
    fn spelling_of_the_folder_does_not_matter() {
        // Settings stores forward slashes; Windows reports backslashes.
        let ds4 = r"C:\Program Files\DAZ 3D\DAZStudio4\DAZStudio.exe";
        assert!(exe_started_from(ds4, "C:/Program Files/DAZ 3D/DAZStudio4"));
        assert!(exe_started_from(ds4, "C:/Program Files/DAZ 3D/DAZStudio4/"));
        assert!(exe_started_from(ds4, r"c:\program files\daz 3d\dazstudio4"));
        assert!(exe_started_from(&ds4.to_uppercase(), "C:/Program Files/DAZ 3D/DAZStudio4"));
    }

    #[test]
    fn a_prefix_is_not_a_folder() {
        // The component-boundary rule (`.ai/gotchas.md`): DAZStudio4 must not
        // swallow DAZStudio40.
        let ds40 = r"C:\Program Files\DAZ 3D\DAZStudio40\DAZStudio.exe";
        assert!(!exe_started_from(ds40, r"C:\Program Files\DAZ 3D\DAZStudio4"));
    }

    #[test]
    fn an_empty_folder_is_no_question() {
        // "Any Daz" is answered before this function is reached; on its own an
        // empty folder must never read as "everything matches".
        assert!(!exe_started_from(
            r"C:\Program Files\DAZ 3D\DAZStudio4\DAZStudio.exe",
            ""
        ));
    }

    #[test]
    fn an_exe_outside_the_folder_never_matches() {
        assert!(!exe_started_from(
            r"D:\Portable\DAZStudio.exe",
            r"C:\Program Files\DAZ 3D\DAZStudio4"
        ));
    }
}
