use std::collections::HashMap;
#[cfg(desktop)]
use std::collections::HashSet;
#[cfg(desktop)]
use std::path::Path;
use std::sync::Mutex;

// --- Multi-window: one project (.dcsp) per window -------------------------
// Each window is pinned to the `.dcsp` it was opened with. The map (window label →
// `.dcsp` path) is the source of truth the frontend reads via `active_project_file`;
// the Home window simply has no entry. Opening a project (the file association, a
// second launch, or the Home "Open") creates — or focuses — its own window.

#[derive(Default)]
pub(crate) struct WindowProjects(Mutex<HashMap<String, String>>);

/// The `.dcsp` path passed on the command line (the OS hands a double-clicked file
/// to the app as an argument), '/'-normalised. None when launched without one.
pub(crate) fn dcsp_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".dcsp"))
        .map(|a| a.replace('\\', "/"))
}

/// Lock the window→project map, recovering from a poisoned mutex (the guarded map
/// is plain data — a peer thread panicking must not wedge every later window op).
pub(crate) fn lock_windows(
    projects: &WindowProjects,
) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
    projects.0.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(desktop)]
fn unique_window_label(app: &tauri::AppHandle, prefix: &str) -> String {
    use tauri::Manager;
    for i in 1.. {
        let label = format!("{prefix}-{i}");
        if app.get_webview_window(&label).is_none() {
            return label;
        }
    }
    unreachable!()
}

/// Open a project in its own window — or focus the one already showing it.
#[cfg(desktop)]
pub(crate) fn open_project_window_impl(app: &tauri::AppHandle, path: &str) -> tauri::Result<()> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    let norm = path.replace('\\', "/");
    let projects = app.state::<WindowProjects>();
    // Hold the lock across find → (prune stale) → allocate → insert so two racing
    // launches (double-clicking two .dcsp files, or a file-assoc launch racing the
    // frontend) can't compute the SAME label or map two paths to one window.
    let label = {
        let mut map = lock_windows(&projects);
        if let Some(label) =
            map.iter().find(|(_, p)| p.eq_ignore_ascii_case(&norm)).map(|(l, _)| l.clone())
        {
            if app.get_webview_window(&label).is_some() {
                let _ = app.get_webview_window(&label).map(|w| w.set_focus());
                return Ok(());
            }
            // Window was closed but its mapping lingered — drop it and reopen.
            map.remove(&label);
        }
        // A label that's neither a live window nor already reserved in the map.
        let mut i = 1;
        let label = loop {
            let candidate = format!("project-{i}");
            if app.get_webview_window(&candidate).is_none() && !map.contains_key(&candidate) {
                break candidate;
            }
            i += 1;
        };
        map.insert(label.clone(), norm.clone());
        label
    };
    let stem = Path::new(&norm)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(format!("{stem} — DTH Character Studio"))
        .inner_size(1440.0, 920.0)
        .min_inner_size(960.0, 640.0)
        // The app UI is dark; force it so tao applies dark-mode theming to the native
        // menu bar too (runtime windows otherwise render a light menu strip).
        .theme(Some(tauri::Theme::Dark))
        .build()?;
    Ok(())
}

/// Open — or focus — the Home (launcher) window (a window with no project mapping).
/// With `new_project`, also open its create-project panel: an already-running
/// window gets the `menu-new-project` event (its listener is live); a fresh
/// window is created on `/?new=1` instead, which the Home route reads on mount —
/// an emit at creation time would race the webview's listener registration.
#[cfg(desktop)]
pub(crate) fn open_home_window_impl(app: &tauri::AppHandle, new_project: bool) -> tauri::Result<()> {
    use tauri::{Emitter, Manager};
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let projects = app.state::<WindowProjects>();
    let with_project: HashSet<String> = lock_windows(&projects).keys().cloned().collect();
    for (label, w) in app.webview_windows() {
        if !with_project.contains(&label) {
            let _ = w.set_focus();
            if new_project {
                let _ = app.emit_to(&label, "menu-new-project", ());
            }
            return Ok(());
        }
    }
    let url = if new_project { "index.html?new=1" } else { "index.html" };
    let label = unique_window_label(app, "home");
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title("DTH Character Studio")
        .inner_size(1440.0, 920.0)
        .min_inner_size(960.0, 640.0)
        .theme(Some(tauri::Theme::Dark))
        .build()?;
    Ok(())
}

/// The `.dcsp` this window was opened with ('' for the Home window).
#[tauri::command]
pub fn active_project_file(window: tauri::Window, projects: tauri::State<WindowProjects>) -> String {
    lock_windows(&projects).get(window.label()).cloned().unwrap_or_default()
}

// `(async)` runs this on a worker thread, not the main thread. Building a webview
// window synchronously on the main thread deadlocks (build() waits for the WebView2
// controller, which needs the very event loop the command is blocking) — the window
// shows white and frozen. Off-thread, build() dispatches creation to a free main
// thread and returns normally.
#[tauri::command(async)]
pub fn open_project_window(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        open_project_window_impl(&app, &path).map_err(|e| e.to_string())
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, path);
        Ok(())
    }
}

#[tauri::command(async)]
pub fn open_home_window(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    {
        open_home_window_impl(&app, false).map_err(|e| e.to_string())
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Ok(())
    }
}
