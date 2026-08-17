// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // FIRST, before Tauri exists: a launch carrying the elevated-install flag is
    // a one-shot worker, not the app (see elevate.rs). It does the copies and
    // exits from in there — nothing below runs for such a launch, so no window,
    // no single-instance handshake and no webview is ever created elevated.
    dth_character_studio_lib::run_worker_if_requested();
    dth_character_studio_lib::run()
}
