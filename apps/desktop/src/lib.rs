mod archive;
mod assets;
mod content;
mod daz;
mod dedup;
mod drives;
mod foreground;
mod fsutil;
mod github;
mod housekeeping;
mod install;
mod poses;
mod report;
#[cfg(test)]
mod testutil;
mod uninstall;
mod windows;

use crate::windows::{dcsp_from_args, lock_windows, WindowProjects};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        // Window label → the `.dcsp` it's showing; read by `active_project_file`.
        .manage(WindowProjects::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        // If launched by double-clicking a `.dcsp` (the file association), pin it to
        // the startup ("main") window so its frontend opens that project.
        .setup(|app| {
            use tauri::Manager;
            if let Some(dcsp) = dcsp_from_args(&std::env::args().collect::<Vec<_>>()) {
                let projects = app.state::<WindowProjects>();
                lock_windows(&projects).insert("main".into(), dcsp);
            }
            Ok(())
        });

    // Updater + relaunch + single-instance + the native app menu are desktop-only.
    #[cfg(desktop)]
    {
        use tauri::Emitter;
        use crate::windows::{build_app_menu, open_home_window_impl, open_project_window_impl};

        builder = builder
            // A second launch (e.g. opening another `.dcsp` from Explorer) is routed
            // here: open it in its own window, or the Home window when it carries none.
            .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                // This callback runs on the main thread; build the window off it (see
                // open_project_window) so creating the webview doesn't deadlock.
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    match dcsp_from_args(&argv) {
                        Some(dcsp) => {
                            let _ = open_project_window_impl(&app, &dcsp);
                        }
                        None => {
                            let _ = open_home_window_impl(&app, false);
                        }
                    }
                });
            }))
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            // Main → New Project / Refresh assets / Exit; Help → About / Check for
            // Updates. New Project opens the Home window natively; the other
            // frontend-driven items emit an event the webview listens for (see
            // __root.tsx); Exit is the predefined Quit. This sets the menu on the
            // config "main" window; runtime windows set the same menu themselves
            // (see windows::build_app_menu), so every window shows the bar.
            .menu(build_app_menu)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "new_project" => {
                    // Focus/open Home AND open its create-project panel.
                    let _ = open_home_window_impl(app, true);
                }
                "refresh_assets" => {
                    let _ = app.emit("menu-refresh-assets", ());
                }
                "about" => {
                    let _ = app.emit("menu-about", ());
                }
                "check_updates" => {
                    let _ = app.emit("menu-check-updates", ());
                }
                _ => {}
            });
    }

    builder
        .invoke_handler(tauri::generate_handler![
            install::install_dth_release,
            install::install_dth_plugin,
            assets::install_daz_assets,
            assets::list_daz_assets,
            dedup::dedup_daz_assets,
            uninstall::default_daz_uninstall_folders,
            uninstall::uninstall_daz,
            github::app_release_tags,
            daz::daz_studio_running,
            daz::run_daz_script,
            foreground::focus_app_window,
            install::install_daz_merge,
            install::install_houdini_presets,
            install::install_unreal_dth,
            install::unreal_dth_present,
            drives::unc_for_path,
            drives::ensure_network_drives,
            poses::pose_asset_frames,
            housekeeping::housekeeping_sweep,
            poses::scan_duf_files,
            windows::active_project_file,
            windows::open_project_window,
            windows::open_home_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
