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

/// The native app menu (Main → New Project / Refresh assets / Exit; Help → About
/// / Check for Updates). Built once per window: the config "main" window gets it
/// via `Builder::menu`, and every runtime window (project windows, extra Home
/// windows) sets its own here — otherwise only the first window shows a menu bar.
/// Item IDs are shared, so clicks route to the app-global `on_menu_event`.
#[cfg(desktop)]
pub(crate) fn build_app_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
    let new_project = MenuItemBuilder::with_id("new_project", "New Project").build(handle)?;
    let refresh = MenuItemBuilder::with_id("refresh_assets", "Refresh assets").build(handle)?;
    let exit = PredefinedMenuItem::quit(handle, Some("Exit"))?;
    let main = SubmenuBuilder::new(handle, "Main")
        .item(&new_project)
        .item(&refresh)
        .separator()
        .item(&exit)
        .build()?;
    let about = MenuItemBuilder::with_id("about", "About").build(handle)?;
    let updates = MenuItemBuilder::with_id("check_updates", "Check for Updates").build(handle)?;
    let help = SubmenuBuilder::new(handle, "Help").item(&about).item(&updates).build()?;
    MenuBuilder::new(handle).item(&main).item(&help).build()
}

/// Serializes PROJECT-window creation, the same way HOME_WINDOW_LOCK does for
/// Home windows. A project window's map reservation exists BEFORE its webview
/// registers (`build()` takes hundreds of ms), so without this lock a racing
/// second open of the same `.dcsp` sees the reservation, finds no window with
/// that label yet, wrongly concludes the mapping is stale, prunes it and builds
/// a SECOND window on the same project → concurrent character writes. Held
/// across find → build, the second caller waits until the first window is
/// registered, then focuses it. Only ever taken on worker threads (the commands
/// are `(async)`), so blocking here never blocks the main thread `build()`
/// dispatches to.
#[cfg(desktop)]
static PROJECT_WINDOW_LOCK: Mutex<()> = Mutex::new(());

/// Open a project in its own window — or focus the one already showing it.
#[cfg(desktop)]
pub(crate) fn open_project_window_impl(app: &tauri::AppHandle, path: &str) -> tauri::Result<()> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    let _creation_guard = PROJECT_WINDOW_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let norm = path.replace('\\', "/");
    let projects = app.state::<WindowProjects>();
    // Hold the map lock across find → (prune stale) → allocate → insert so two
    // racing launches (double-clicking two .dcsp files, or a file-assoc launch
    // racing the frontend) can't compute the SAME label or map two paths to one
    // window. The map lock stays SHORT (never across build) — `active_project_file`
    // runs on the main thread and must never wait on a window build.
    let label = {
        let mut map = lock_windows(&projects);
        if let Some(label) =
            map.iter().find(|(_, p)| p.eq_ignore_ascii_case(&norm)).map(|(l, _)| l.clone())
        {
            if app.get_webview_window(&label).is_some() {
                let _ = app.get_webview_window(&label).map(|w| w.set_focus());
                return Ok(());
            }
            // The startup ("main") window's mapping is inserted in setup(), BEFORE
            // tauri builds that window — a file-assoc second launch arriving in
            // that gap must not prune it and open a duplicate. The starting main
            // window will show this project itself.
            if label == "main" {
                return Ok(());
            }
            // Any other project label is only built while PROJECT_WINDOW_LOCK is
            // held (which we hold now), so "mapping present, window absent" here
            // genuinely means stale (destroyed window / failed build) — drop it
            // and reopen.
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
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(format!("{stem} — DTH Character Studio"))
        .inner_size(1440.0, 920.0)
        .min_inner_size(960.0, 640.0)
        // The app UI is dark; force it so tao applies dark-mode theming to the native
        // menu bar too (runtime windows otherwise render a light menu strip).
        .theme(Some(tauri::Theme::Dark))
        // Runtime windows don't inherit the app menu (only the config "main" window
        // does) — give this one its own so Main/Help show here too.
        .menu(build_app_menu(app)?)
        .build();
    if let Err(e) = built {
        // A failed build must not leave its reservation behind — the next open of
        // this project would "focus" a window that never existed.
        lock_windows(&projects).remove(&label);
        return Err(e);
    }
    Ok(())
}

/// Serializes Home-window creation: home windows deliberately have no
/// `WindowProjects` entry, so `unique_window_label` has no reservation step —
/// two concurrent opens could both pick "home-1" and the second `build()` would
/// fail. One lock across find→build closes that race (project windows reserve
/// their label in the map instead).
#[cfg(desktop)]
static HOME_WINDOW_LOCK: Mutex<()> = Mutex::new(());

/// Open — or focus — the Home (launcher) window (a window with no project mapping).
/// With `new_project`, also open its create-project panel: an already-running
/// window gets the `menu-new-project` event (its listener is live); a fresh
/// window is created on `/?new=1` instead, which the Home route reads on mount —
/// an emit at creation time would race the webview's listener registration.
#[cfg(desktop)]
pub(crate) fn open_home_window_impl(app: &tauri::AppHandle, new_project: bool) -> tauri::Result<()> {
    use tauri::{Emitter, Manager};
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let _guard = HOME_WINDOW_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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
        // As above: a runtime Home window needs its own menu (the config "main"
        // window is the only one that inherits the app menu).
        .menu(build_app_menu(app)?)
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
