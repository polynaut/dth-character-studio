//! Installing the Daz plugins with administrator rights WITHOUT elevating the
//! studio.
//!
//! Copying a couple of DLLs into `<Daz>/plugins` is the only thing in this app
//! that needs administrator rights, and relaunching the whole studio to do it
//! charges for that copy long after it is finished: an elevated session cannot
//! see the user's mapped network drives (`drives.rs`), Windows UIPI silently
//! drops drag-and-drop from a normal Explorer into an elevated window (issue
//! #342 — `post-install-elevation-notice.tsx` exists purely to undo the
//! elevation we asked for), and every file the session writes afterwards gets an
//! elevated owner.
//!
//! So the elevation is scoped to the copy. This launches ONE elevated child —
//! our own executable, with a hidden flag — which performs the copies through
//! the SAME `install::install_plugin_dlls` the in-process path uses, writes its
//! report to a file, and exits. One UAC prompt, no elevated window, no elevated
//! session, and no second copy implementation that could drift from the first.
//!
//! The hidden flag lowers no bar: launching the child elevated needs UAC consent
//! either way, and anyone who can obtain that can already do anything. What the
//! flag must never do is reach `run()` — a fall-through would put an elevated
//! WINDOW on screen, which is the exact outcome this module exists to avoid.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::report::InstallReport;

/// The argument that turns a normal launch into a one-shot install worker.
/// Matched EXACTLY (see `worker_payload_arg`) — never by prefix.
const WORKER_FLAG: &str = "--dth-elevated-plugin-install";

/// The refusal when the user dismisses the UAC prompt.
///
/// CONTRACT with the UI: `daz-plugins-section.tsx` matches this to report a
/// neutral "nothing was installed" instead of an error toast — declining a
/// permission prompt is a choice, not a failure. The test below pins the phrase
/// so a rewording fails there rather than silently turning a cancel back into an
/// alarming error.
pub(crate) const ELEVATION_CANCELLED: &str =
    "Cancelled at the Windows permission prompt — nothing was installed.";

/// How long the parent waits for the child before giving up on it. The child
/// copies a handful of small DLLs and exits, so this is not a budget — it is a
/// backstop so a wedged helper cannot hang the Settings panel forever. On expiry
/// the child is LEFT RUNNING (killing it mid-copy would be strictly worse) and
/// the wait is reported as exactly what it was.
#[cfg(windows)]
const WORKER_TIMEOUT_MS: u32 = 5 * 60 * 1000;

#[cfg(windows)]
mod exit {
    /// Everything copied (individual copies still report per-step).
    pub(super) const OK: i32 = 0;
    /// The payload didn't decode — the child did nothing.
    pub(super) const BAD_PAYLOAD: i32 = 2;
    /// The copies ran but the report couldn't be handed back.
    pub(super) const NO_RESULT: i32 = 3;
}

/// One plugin copy: a folder of DLLs → a Daz Studio install root.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginJob {
    label: String,
    exporter_folder: String,
    daz_install_folder: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ElevatedPluginRequest {
    jobs: Vec<PluginJob>,
}

/// What the parent hands the child. It travels as a hex-encoded command-line
/// ARGUMENT, not a file: a file would sit on disk between being written and
/// being read by an elevated process, and anything running as the user could
/// rewrite it in that window — a copy of attacker-chosen bytes to an
/// attacker-chosen path, as administrator. The paths are not secret (a command
/// line is world-readable), so the only property needed is that they cannot be
/// changed after consent is given.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerPayload {
    jobs: Vec<PluginJob>,
    /// Where the child writes its `InstallReport`. Tampering here can only
    /// corrupt a report that is already displayed as untrusted text.
    result_path: String,
}

// --- payload encoding ------------------------------------------------------

// Hex, not base64 or raw JSON: the payload becomes ONE token of a command-line
// string that `ShellExecuteExW` re-parses, and hex has no character that needs
// quoting or escaping. JSON is full of quotes and backslashes (Windows paths
// doubly so), and getting that escaping subtly wrong is how a path with a space
// becomes two arguments. There is no crate for this in the tree and it does not
// earn one.

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn from_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(text.len() / 2);
    for pair in bytes.chunks(2) {
        let hi = (pair[0] as char).to_digit(16)?;
        let lo = (pair[1] as char).to_digit(16)?;
        out.push((hi * 16 + lo) as u8);
    }
    Some(out)
}

// --- the elevated child ----------------------------------------------------

/// The payload argument when this process was launched as an install worker.
///
/// The flag must match EXACTLY and be followed by exactly one value; anything
/// else means this is a normal launch. Written as a total function over the
/// argument list so the "is this a worker?" question has one answer that a test
/// can ask directly.
fn worker_payload_arg(args: &[String]) -> Option<String> {
    let index = args.iter().position(|a| a == WORKER_FLAG)?;
    args.get(index + 1).cloned()
}

/// Run the copies and hand back a report — the whole of the child's life.
///
/// Every failure is swallowed into an exit code on purpose: the child has no UI
/// and no console in a release build (`windows_subsystem = "windows"`), so there
/// is nowhere for a panic message to go. The parent turns the code into
/// something a human can read.
#[cfg(windows)]
fn worker_main(payload_hex: &str) -> i32 {
    let Some(bytes) = from_hex(payload_hex) else {
        return exit::BAD_PAYLOAD;
    };
    let Ok(payload) = serde_json::from_slice::<WorkerPayload>(&bytes) else {
        return exit::BAD_PAYLOAD;
    };
    let steps: Vec<_> = payload
        .jobs
        .iter()
        .map(|job| {
            crate::install::install_plugin_dlls(
                &job.label,
                Path::new(&job.exporter_folder),
                Path::new(&job.daz_install_folder),
                // A dry run never needs administrator rights, so it never gets
                // here — the elevated path is only ever a real install.
                false,
                true,
            )
        })
        .collect();
    let total_files = steps.iter().map(|s| s.files).sum();
    let report = InstallReport { dry_run: false, steps, total_files };
    let Ok(json) = serde_json::to_vec(&report) else {
        return exit::NO_RESULT;
    };
    if std::fs::write(&payload.result_path, json).is_err() {
        return exit::NO_RESULT;
    }
    exit::OK
}

/// Called FIRST from `main()`. Returns immediately for a normal launch; for a
/// worker launch it never returns — it does the copies and exits the process.
///
/// The exit is unconditional by construction: once the flag is recognised there
/// is no path back to the caller, so a bug inside the worker can never surface
/// as an elevated application window.
pub fn run_worker_if_requested() {
    // args_os, not args: `args()` PANICS on a non-Unicode argument, and this
    // runs before anything else in the process (same reasoning as lib.rs).
    let args: Vec<String> =
        std::env::args_os().map(|a| a.to_string_lossy().into_owned()).collect();
    let Some(payload_hex) = worker_payload_arg(&args) else {
        return;
    };
    #[cfg(windows)]
    std::process::exit(worker_main(&payload_hex));
    // The flag can only be produced by the Windows-only parent below, but a
    // worker launch must still never fall through to the app.
    #[cfg(not(windows))]
    std::process::exit(exit_code_not_windows());
}

#[cfg(not(windows))]
fn exit_code_not_windows() -> i32 {
    2
}

// --- the unelevated parent -------------------------------------------------

/// Install the plugin DLLs with administrator rights: one UAC prompt for the
/// whole batch, performed by a short-lived child process, with this window left
/// exactly as unelevated as it was.
///
/// Returns the child's report, so a partial success reads the same as it does
/// for the in-process install — one failed step beside three good ones.
// `(async)`: this BLOCKS on the child (and on the user answering the UAC
// prompt). On the main thread that would freeze every window.
#[tauri::command(async)]
pub fn install_dth_plugins_elevated(
    request: ElevatedPluginRequest,
) -> Result<InstallReport, String> {
    #[cfg(windows)]
    {
        windows_impl::install(request.jobs)
    }
    #[cfg(not(windows))]
    {
        let _ = request;
        Err("Installing with administrator rights is Windows-only.".into())
    }
}

#[cfg(windows)]
mod windows_impl {
    use super::{
        exit, to_hex, PluginJob, WorkerPayload, ELEVATION_CANCELLED, WORKER_FLAG,
        WORKER_TIMEOUT_MS,
    };
    use crate::report::InstallReport;

    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, ERROR_CANCELLED, HANDLE, WAIT_OBJECT_0,
    };
    use windows_sys::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS,
        SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    /// A temp path for the child's report. Unique per call without a random
    /// number generator: one process can't run two of these at once from the
    /// same nanosecond.
    fn result_path() -> std::path::PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("dth-plugin-install-{}-{stamp}.json", std::process::id()))
    }

    /// Rewrite a path on a mapped network drive to its UNC form.
    ///
    /// THE reason an elevated helper fails on a machine where the Daz release
    /// folders live on a mapped drive: drive letters are per-logon-session, so
    /// the administrator token has none of them, and `X:\…` simply does not
    /// exist over there. This runs in the unelevated parent, which can still see
    /// the mapping. A local path is returned unchanged.
    fn share_visible(path: &str) -> String {
        crate::drives::unc_path(path).unwrap_or_else(|| path.to_string())
    }

    pub(super) fn install(jobs: Vec<PluginJob>) -> Result<InstallReport, String> {
        if jobs.is_empty() {
            return Err("Nothing to install.".into());
        }
        let jobs = jobs
            .into_iter()
            .map(|job| PluginJob {
                label: job.label,
                exporter_folder: share_visible(&job.exporter_folder),
                daz_install_folder: share_visible(&job.daz_install_folder),
            })
            .collect();

        let result_path = result_path();
        let payload = WorkerPayload {
            jobs,
            result_path: result_path.to_string_lossy().into_owned(),
        };
        let json = serde_json::to_vec(&payload)
            .map_err(|e| format!("couldn't describe the install for the helper: {e}"))?;
        let exe = std::env::current_exe()
            .map_err(|e| format!("couldn't resolve the app executable: {e}"))?;
        let parameters = format!("{WORKER_FLAG} {}", to_hex(&json));

        let code = run_elevated(&exe.to_string_lossy(), &parameters)?;
        let report = match std::fs::read(&result_path) {
            Ok(bytes) => serde_json::from_slice::<InstallReport>(&bytes)
                .map_err(|e| format!("the helper's report couldn't be read back: {e}")),
            Err(e) => Err(match code {
                exit::BAD_PAYLOAD => {
                    "the helper rejected the install description — nothing was copied".to_string()
                }
                exit::NO_RESULT => {
                    "the copies ran but the helper couldn't write its report — check the plugins \
                     folder, then rescan"
                        .to_string()
                }
                _ => format!("the helper left no report (exit code {code}): {e}"),
            }),
        };
        // Best-effort: a leftover temp file is harmless, and failing the whole
        // install because it couldn't be deleted would not be.
        let _ = std::fs::remove_file(&result_path);
        report
    }

    /// ShellExecuteEx with the `runas` verb — the only way to start a process
    /// with a fresh elevated token. `Command::spawn` cannot: a child inherits
    /// this process's token, which is the whole problem.
    fn run_elevated(exe: &str, parameters: &str) -> Result<i32, String> {
        // ShellExecuteEx wants COM on the calling thread, and a Tauri async
        // command runs on a pool thread that has none. RPC_E_CHANGED_MODE means
        // the thread is already initialised in the other model — usable, but NOT
        // ours to uninitialise.
        // SAFETY: a plain COM init/uninit pair scoped to this call.
        let hr = unsafe {
            // The COINIT_* constants are i32 in windows-sys; the parameter is u32.
            CoInitializeEx(
                std::ptr::null(),
                (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
            )
        };
        let owns_com = hr >= 0;
        let result = shell_execute_and_wait(exe, parameters);
        if owns_com {
            // SAFETY: balanced against the successful CoInitializeEx above.
            unsafe { CoUninitialize() };
        }
        result
    }

    fn shell_execute_and_wait(exe: &str, parameters: &str) -> Result<i32, String> {
        let verb = to_wide("runas");
        let file = to_wide(exe);
        let params = to_wide(parameters);

        // SAFETY: SHELLEXECUTEINFOW is plain data. Everything not set below is
        // zeroed (null handles/strings, which the API documents as "unused"),
        // and the three wide buffers outlive the call.
        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        // NOCLOSEPROCESS: we need the child's handle to wait on it.
        // NOASYNC: this thread has no message loop and may end right after.
        // FLAG_NO_UI: failures come back as codes, not as a shell error box
        //   behind the app window that nobody sees. It does NOT suppress the UAC
        //   prompt — that is the one dialog this whole path is asking for.
        info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = params.as_ptr();
        // The child has no window; SW_HIDE keeps a console build from flashing one.
        info.nShow = SW_HIDE;

        // SAFETY: `info` is fully initialised per the contract above.
        let started = unsafe { ShellExecuteExW(&mut info) };
        if started == 0 {
            // SAFETY: reading the calling thread's last error immediately after.
            let err = unsafe { GetLastError() };
            return Err(if err == ERROR_CANCELLED {
                ELEVATION_CANCELLED.to_string()
            } else {
                format!("couldn't start the install helper with administrator rights (error {err})")
            });
        }
        let process: HANDLE = info.hProcess;
        if process.is_null() {
            return Err("the install helper started but couldn't be waited on".into());
        }
        // SAFETY: `process` is a live handle from a successful ShellExecuteExW.
        let waited = unsafe { WaitForSingleObject(process, WORKER_TIMEOUT_MS) };
        let mut code: u32 = 0;
        let exit_code = if waited == WAIT_OBJECT_0 {
            // SAFETY: the process has exited; the handle is still open.
            if unsafe { GetExitCodeProcess(process, &mut code) } == 0 {
                Err("the install helper finished but its result couldn't be read".to_string())
            } else {
                Ok(code as i32)
            }
        } else {
            // Deliberately NOT killed: it may be mid-copy, and a half-copied
            // plugins folder is worse than a slow one.
            Err(format!(
                "the install helper is still running after {} minutes — check the plugins folder, \
                 then rescan",
                WORKER_TIMEOUT_MS / 60_000
            ))
        };
        // SAFETY: closing our own handle; this does not end the process.
        unsafe { CloseHandle(process) };
        exit_code
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_round_trips_the_payload() {
        let payload = WorkerPayload {
            jobs: vec![PluginJob {
                label: "Exporter plugin → Daz Studio 4.23".into(),
                // A space, a backslash, a quote and a non-ASCII character — the
                // four things that break naive command-line escaping.
                exporter_folder: r#"X:\_3d\daz 3d\"rel"\Ärger"#.into(),
                daz_install_folder: r"C:\Program Files\DAZ 3D\DAZStudio4".into(),
            }],
            result_path: r"C:\Temp\r.json".into(),
        };
        let json = serde_json::to_vec(&payload).unwrap();
        let hex = to_hex(&json);
        // The encoded form is a single command-line token — nothing to escape.
        assert!(hex.chars().all(|c| c.is_ascii_hexdigit()), "hex: {hex}");
        let back: WorkerPayload = serde_json::from_slice(&from_hex(&hex).unwrap()).unwrap();
        assert_eq!(back.jobs[0].exporter_folder, payload.jobs[0].exporter_folder);
        assert_eq!(back.jobs[0].daz_install_folder, payload.jobs[0].daz_install_folder);
        assert_eq!(back.result_path, payload.result_path);
    }

    #[test]
    fn from_hex_rejects_junk() {
        assert!(from_hex("abc").is_none(), "odd length");
        assert!(from_hex("zz").is_none(), "not hex");
        assert_eq!(from_hex("").unwrap(), Vec::<u8>::new());
    }

    #[test]
    fn only_the_exact_flag_makes_this_a_worker() {
        // The load-bearing safety property: a normal launch must NEVER be taken
        // for a worker launch, or the app exits instead of opening a window.
        let worker = vec![WORKER_FLAG.to_string(), "7b7d".to_string()];
        assert_eq!(worker_payload_arg(&worker).as_deref(), Some("7b7d"));

        let normal = vec![
            r"C:\Program Files\DTH Character Studio\dth-character-studio.exe".to_string(),
            r"D:\Projects\Kira\Kira.dcsp".to_string(),
        ];
        assert!(worker_payload_arg(&normal).is_none(), "a .dcsp launch");
        // Near-misses: a prefix match, a suffix match, and the flag with no value.
        assert!(worker_payload_arg(&[format!("{WORKER_FLAG}=7b7d")]).is_none());
        assert!(worker_payload_arg(&[format!("x{WORKER_FLAG}")]).is_none());
        assert!(worker_payload_arg(&[WORKER_FLAG.to_string()]).is_none());
        assert!(worker_payload_arg(&[]).is_none());
    }

    #[test]
    fn the_cancel_message_pins_the_ui_matched_phrase() {
        // daz-plugins-section.tsx keys on this to report a cancelled UAC prompt
        // as a neutral note rather than an error toast. Reword both together.
        assert_eq!(
            ELEVATION_CANCELLED,
            "Cancelled at the Windows permission prompt — nothing was installed."
        );
    }
}
