mod archive;
mod assets;
mod avatar;
mod character_zip;
mod content;
#[cfg(test)]
mod contract_tests;
mod daz;
mod dedup;
mod drives;
mod elevation;
mod exports;
mod foreground;
mod fsutil;
mod github;
mod houdini;
mod houdini_install;
mod houdini_material;
mod housekeeping;
mod install;
mod junction;
mod poses;
mod procs;
mod report;
mod shellopen;
#[cfg(test)]
mod testutil;
mod uninstall;
mod unreal_install;
mod windows;

use crate::windows::{dcsp_from_args, lock_windows, ProjectMapping, WindowProjects};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        // Window label → the `.dcsp` it's showing; read by `active_project_file`.
        .manage(WindowProjects::default())
        // A closed window's label→project mapping is stale the moment it's gone —
        // drop it so the label is reusable and the map can't grow for the session.
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                use tauri::Manager;
                let projects = window.app_handle().state::<WindowProjects>();
                lock_windows(&projects).remove(window.label());
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        // If launched by double-clicking a `.dcsp` (the file association), pin it to
        // the startup ("main") window so its frontend opens that project.
        .setup(|app| {
            use tauri::Manager;
            // args_os, not args: `args()` PANICS on a non-Unicode argument, and
            // Windows filenames can carry unpaired surrogates — a `.dcsp` named
            // that way would crash the app before any window exists. Lossy is
            // fine here: the extension match still works, and a path mangled by
            // the replacement char simply resolves to no project.
            let args: Vec<String> =
                std::env::args_os().map(|a| a.to_string_lossy().into_owned()).collect();
            if let Some(dcsp) = dcsp_from_args(&args) {
                // Build the mapping FIRST — its identity key canonicalizes (I/O)
                // and must never run under the map lock (windows::ProjectPathKey).
                // Setup runs before any window shows, and the file was just
                // double-clicked, so the one-time cost here is fine.
                let mapping = ProjectMapping::new(dcsp);
                let projects = app.state::<WindowProjects>();
                lock_windows(&projects).insert("main".into(), mapping);
            }
            // The config's `main` window takes its title from tauri.conf.json,
            // so it never passes through window_title() — mark it here. Reads
            // each window's CURRENT title rather than assuming one, and
            // window_title is idempotent, so this can't stack prefixes.
            if crate::elevation::is_elevated() {
                for (_, window) in app.webview_windows() {
                    if let Ok(current) = window.title() {
                        let _ = window.set_title(&crate::elevation::window_title(&current));
                    }
                }
            }
            Ok(())
        });

    // Updater + relaunch + single-instance + the native app menu are desktop-only.
    #[cfg(desktop)]
    {
        use crate::windows::{
            build_app_menu, emit_menu_to_focused, open_home_window_impl, open_project_window_impl,
        };

        builder = builder
            // A second launch (e.g. opening another `.dcsp` from Explorer) is routed
            // here: open it in its own window, or the Home window when it carries none.
            .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                // This callback runs on the main thread; build the window off it (see
                // open_project_window) so creating the webview doesn't deadlock.
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let result = match dcsp_from_args(&argv) {
                        Some(dcsp) => open_project_window_impl(&app, &dcsp),
                        None => open_home_window_impl(&app, false),
                    };
                    // Otherwise a failed second launch (e.g. a builder error) gives
                    // zero feedback in the running instance.
                    if let Err(e) = result {
                        eprintln!("second-launch window failed: {e}");
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
                    // Focus/open Home AND open its create-project panel. Menu events
                    // run on the main thread — build the window off it, exactly like
                    // the single-instance handler above (a synchronous build() on the
                    // main thread deadlocks; see windows::open_project_window).
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = open_home_window_impl(&app, true) {
                            eprintln!("New Project window failed: {e}");
                        }
                    });
                }
                // These frontend-driven items go to the FOCUSED window only — a
                // broadcast (`app.emit`) reaches every window, so with two open
                // windows one "Check for Updates" click used to spawn an update
                // check (and its prompt) in each of them.
                "refresh_assets" => emit_menu_to_focused(app, "menu-refresh-assets"),
                "about" => emit_menu_to_focused(app, "menu-about"),
                "check_updates" => emit_menu_to_focused(app, "menu-check-updates"),
                _ => {}
            });
    }

    builder
        .invoke_handler(tauri::generate_handler![
            install::install_dth_release,
            install::install_dth_plugin,
            assets::install_daz_assets,
            assets::list_daz_assets,
            avatar::upscale_avatar_file,
            avatar::downscale_avatar_png,
            dedup::dedup_daz_assets,
            uninstall::default_daz_uninstall_folders,
            uninstall::uninstall_daz,
            github::app_release_tags,
            daz::daz_studio_running,
            daz::run_daz_script,
            daz::launch_daz_studio,
            foreground::focus_app_window,
            houdini::create_houdini_project,
            houdini::launch_houdini_job,
            houdini::houdini_running,
            houdini::remove_dir_if_empty,
            houdini_install::houdini_installs,
            houdini_material::run_houdini_material_util,
            houdini_material::restore_houdini_backup,
            junction::remove_junction,
            exports::move_exports,
            shellopen::shell_open_file,
            install::install_daz_merge,
            install::install_houdini_presets,
            install::install_unreal_dth,
            install::unreal_dth_present,
            unreal_install::unreal_engine_installs,
            unreal_install::scan_unreal_plugins,
            unreal_install::unreal_project_state,
            unreal_install::install_unreal_plugin,
            drives::unc_for_path,
            drives::ensure_network_drives,
            elevation::elevated_session,
            elevation::relaunch_deelevated,
            poses::pose_asset_frames,
            poses::scene_wearables,
            housekeeping::housekeeping_sweep,
            poses::scan_duf_files,
            windows::active_project_file,
            windows::open_project_window,
            windows::release_project_window,
            windows::sync_renamed_project_window,
            fsutil::probe_locked_files,
            fsutil::scan_files_by_ext,
            fsutil::write_text_file_if_unchanged,
            character_zip::export_character_zip,
            character_zip::read_character_zip_manifest,
            character_zip::list_character_zip_entries,
            character_zip::read_character_zip_entry,
            character_zip::extract_character_zip
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
