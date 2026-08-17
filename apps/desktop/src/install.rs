use serde::Deserialize;
use std::fs;
use std::path::Path;

use crate::fsutil::{copy_dir, copy_dir_add_only, count_files, folder_name};
use crate::report::{
    io_detail, step_err, step_ok, step_skip, InstallReport, InstallStep, PLUGIN_ADMIN_HINT,
    PLUGIN_ELEVATED_DENIED_HINT, PLUGIN_LOCKED_HINT,
};

// Paths are resolved by the frontend (which release/plugin, where); the native
// side only does the heavy recursive copy. Keys arrive camelCase from JS. The
// install is split in two — the DTH release content vs the (admin-sensitive)
// plugin DLLs — so each reports only its own steps and fails independently.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseInstallRequest {
    /// Release root holding `Daz Studio Content` and `Houdini Assets`.
    release_root: String,
    /// "My DAZ 3D Library" — destination for the release's Daz content.
    daz_lib_folder: String,
    /// Houdini documents folder — destination for the release's Houdini assets ("" skips).
    houdini_docs_folder: String,
    /// Count what would be copied without writing anything.
    dry_run: bool,
    /// Which half to install: "daz", "houdini", or "all" (default — both).
    #[serde(default = "default_install_target")]
    target: String,
}

fn default_install_target() -> String {
    "all".into()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginInstallRequest {
    /// Folder holding the exporter DLLs (`dth_exporter.dll` / `dsp_dth_exporter.dll`).
    exporter_folder: String,
    /// Daz Studio install root — DLLs go into its `plugins` subfolder.
    daz_install_folder: String,
    dry_run: bool,
    /// Step label in the report — defaults to the Exporter plugin (the bundled
    /// Runner plugin install reuses this command with its own label).
    #[serde(default)]
    label: Option<String>,
}

/// Append `SHARED_PRESETS` + `HOUDINI_PATH` to `<houdini_docs>/houdini.env` if not
/// already present (idempotent). "Present" is judged per-line on NON-comment
/// lines — a commented-out `# SHARED_PRESETS = …` used to count as wired,
/// yielding a `HOUDINI_PATH` that references an undefined variable. The rewrite
/// is atomic (temp file + rename), so a mid-write failure can never leave the
/// user's houdini.env truncated. Returns whether it changed the file.
fn wire_houdini_env(houdini_docs: &Path, presets_dir: &Path) -> std::io::Result<bool> {
    let env_path = houdini_docs.join("houdini.env");
    let presets_fwd = presets_dir.display().to_string().replace('\\', "/");
    // Distinguish "no file yet" (start empty) from a real read error / non-UTF-8
    // content: a blanket unwrap_or_default() would treat an unreadable existing
    // houdini.env as empty and then OVERWRITE it, wiping the user's other Houdini
    // settings. Read as bytes (so a non-UTF-8 file is a hard error, not "empty")
    // and only treat NotFound as a fresh start.
    let existing = match fs::read(&env_path) {
        Ok(bytes) => String::from_utf8(bytes)
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "houdini.env is not valid UTF-8 — leaving it untouched"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(e) => return Err(e),
    };
    // Only lines that aren't comments count as existing wiring.
    let active_lines: Vec<String> = existing
        .lines()
        .map(|l| l.trim_start())
        .filter(|l| !l.starts_with('#'))
        .map(|l| l.to_lowercase())
        .collect();
    let defines = active_lines.iter().any(|l| {
        l.contains('=') && l.split('=').next().is_some_and(|name| name.trim() == "shared_presets")
    });
    let references = active_lines.iter().any(|l| l.contains("$shared_presets"));
    let mut add = String::new();
    if !defines {
        add.push_str(&format!("SHARED_PRESETS = \"{presets_fwd}\"\n"));
    }
    if !references {
        add.push_str("HOUDINI_PATH = $HOUDINI_PATH;$SHARED_PRESETS\n");
    }
    if add.is_empty() {
        return Ok(false);
    }
    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(&add);
    // Atomic replace: `fs::write` truncates before writing, so a crash mid-write
    // would destroy the file. Write beside it, then rename over (`fs::rename`
    // replaces an existing destination file on Windows).
    let tmp = houdini_docs.join("houdini.env.dth-tmp");
    fs::write(&tmp, &content)?;
    if let Err(e) = fs::rename(&tmp, &env_path) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(true)
}

/// Append the skipped-directory-links note to a step detail when there were any
/// — a dir symlink/junction is never followed while copying (cycle/escape risk),
/// and that skip must be visible instead of silent.
fn with_link_note(detail: String, skipped_links: u64) -> String {
    if skipped_links == 0 {
        detail
    } else {
        format!("{detail} · {skipped_links} linked folder(s) skipped (links are never followed)")
    }
}

/// Copy a whole folder `src` → `dst` (e.g. `Daz Studio Content/data` → `<lib>/data`).
fn install_folder(label: &str, src: &Path, dst: &Path, dry: bool) -> InstallStep {
    if !src.exists() {
        return step_skip(label, format!("not in release ({})", src.display()));
    }
    if dry {
        return step_ok(label, count_files(src), format!("would copy → {}", dst.display()));
    }
    match copy_dir(src, dst) {
        Ok(stats) => step_ok(
            label,
            stats.files,
            with_link_note(format!("→ {}", dst.display()), stats.skipped_links),
        ),
        Err(e) => step_err(label, io_detail(&format!("{} → {}", src.display(), dst.display()), &e)),
    }
}

/// Merge each entry of `src_dir` into `dst_dir` (e.g. `Houdini Assets/*` →
/// `<houdini docs>/`), preserving other files already there.
fn install_contents(label: &str, src_dir: &Path, dst_dir: &Path, dry: bool) -> InstallStep {
    if !src_dir.exists() {
        return step_skip(label, format!("not in release ({})", src_dir.display()));
    }
    let entries = match fs::read_dir(src_dir) {
        Ok(e) => e,
        Err(e) => return step_err(label, e.to_string()),
    };
    if !dry {
        if let Err(e) = fs::create_dir_all(dst_dir) {
            return step_err(label, io_detail(&dst_dir.display().to_string(), &e));
        }
    }
    let mut files = 0u64;
    let mut skipped_links = 0u64;
    for entry in entries {
        // An erroring entry is a hard error, never a silent skip — `flatten()`
        // here installed a SUBSET of a partially-listable folder and reported
        // ok, inconsistent with copy_dir (unreadable → hard error).
        let entry = match entry {
            Ok(e) => e,
            Err(e) => return step_err(label, io_detail(&src_dir.display().to_string(), &e)),
        };
        let from = entry.path();
        let to = dst_dir.join(entry.file_name());
        if dry {
            files += if from.is_dir() { count_files(&from) } else { 1 };
            continue;
        }
        let result = if from.is_dir() {
            copy_dir(&from, &to).map(|stats| {
                skipped_links += stats.skipped_links;
                stats.files
            })
        } else {
            fs::copy(&from, &to).map(|_| 1)
        };
        match result {
            Ok(n) => files += n,
            Err(e) => return step_err(label, io_detail(&from.display().to_string(), &e)),
        }
    }
    let detail = if dry {
        format!("would copy → {}", dst_dir.display())
    } else {
        with_link_note(format!("→ {}", dst_dir.display()), skipped_links)
    };
    step_ok(label, files, detail)
}

/// Which guidance a failed plugin copy has earned, or None when the error is
/// neither of the two causes we can name.
///
/// The causes are genuinely different — elevation fixes a permission refusal and
/// does NOTHING for a DLL Daz Studio has loaded — so they must never be offered
/// as one blurred hint. With the install able to elevate on demand, a locked DLL
/// that suggests "try administrator rights" turns that button into a cargo cult:
/// click, fail identically, stop trusting it. A cause we can't name gets no hint
/// at all rather than a guessed one (a full disk is not an elevation problem).
fn copy_failure_hint(e: &std::io::Error, elevated: bool) -> Option<&'static str> {
    // ERROR_SHARING_VIOLATION (32) — the file is open in another process. Rust
    // maps it to no ErrorKind of its own, so the raw OS code is the only way to
    // tell it apart from a refusal.
    if e.raw_os_error() == Some(32) {
        return Some(PLUGIN_LOCKED_HINT);
    }
    // ERROR_ACCESS_DENIED (5) — what Program Files returns unelevated.
    if e.kind() == std::io::ErrorKind::PermissionDenied {
        return Some(if elevated { PLUGIN_ELEVATED_DENIED_HINT } else { PLUGIN_ADMIN_HINT });
    }
    None
}

/// A failed plugin-folder READ, worded like the copy failures below: the actual
/// error first, then only a hint we can name.
///
/// Deliberately not `io_detail` — that one ends in "restart DTH Character Studio
/// as administrator", which is the answer this whole path replaced, and which is
/// actively WRONG for a source folder on a mapped drive: an elevated session is
/// precisely where that drive letter stops existing (drives.rs). Nothing in the
/// plugin install may still send the user to a relaunch.
fn plugin_io_detail(prefix: &str, e: &std::io::Error, elevated: bool) -> String {
    match copy_failure_hint(e, elevated) {
        Some(hint) => format!("{prefix}: {e} — {hint}"),
        None => format!("{prefix}: {e}"),
    }
}

/// Copy every `.dll` in `exporter_folder` into `<daz_install>/plugins`.
///
/// `elevated` only chooses the wording of a permission failure — it is a
/// statement about the process this runs in, not a request to elevate. The
/// elevated path (`elevate.rs`) calls THIS function from its child process, so
/// both paths copy identically and can never drift.
pub(crate) fn install_plugin_dlls(
    label: &str,
    exporter_folder: &Path,
    daz_install: &Path,
    dry: bool,
    elevated: bool,
) -> InstallStep {
    // `try_exists`, not `exists`: the latter answers false for "I'm not allowed
    // to look", and the elevated child is exactly where that happens — a UNC
    // source whose share the administrator token has no session to would report
    // as a folder that isn't there, sending the user to look for a path they can
    // see perfectly well themselves.
    match exporter_folder.try_exists() {
        Ok(true) => {}
        Ok(false) => {
            return step_skip(
                label,
                format!("exporter folder not found ({})", exporter_folder.display()),
            )
        }
        Err(e) => {
            return step_err(
                label,
                plugin_io_detail(
                    &format!("couldn't read {}", exporter_folder.display()),
                    &e,
                    elevated,
                ),
            )
        }
    }
    // An erroring entry is a hard error, never a silent drop — same posture as
    // install_contents: a partially-listable folder installing a subset of the
    // plugin DLLs while reporting ok is exactly the invisible-failure class the
    // install report exists to prevent.
    let mut dlls: Vec<std::path::PathBuf> = Vec::new();
    match fs::read_dir(exporter_folder) {
        Ok(entries) => {
            for entry in entries {
                match entry {
                    Ok(e) => dlls.push(e.path()),
                    Err(e) => {
                        return step_err(
                            label,
                            plugin_io_detail(&exporter_folder.display().to_string(), &e, elevated),
                        )
                    }
                }
            }
        }
        Err(e) => {
            return step_err(
                label,
                plugin_io_detail(
                    &format!("couldn't read {}", exporter_folder.display()),
                    &e,
                    elevated,
                ),
            )
        }
    }
    dlls.retain(|p| {
        p.is_file()
            && p.extension()
                .and_then(|s| s.to_str())
                .map(|s| s.eq_ignore_ascii_case("dll"))
                .unwrap_or(false)
    });
    if dlls.is_empty() {
        return step_skip(label, "no .dll files in the exporter folder".into());
    }
    let plugins = daz_install.join("plugins");
    if dry {
        return step_ok(label, dlls.len() as u64, format!("would copy {} dll(s) → {}", dlls.len(), plugins.display()));
    }
    if !plugins.exists() {
        return step_err(
            label,
            format!("plugins folder not found: {} — is Daz Studio installed there?", plugins.display()),
        );
    }
    let mut files = 0u64;
    for dll in &dlls {
        let to = plugins.join(dll.file_name().unwrap());
        if let Err(e) = fs::copy(dll, &to) {
            // Always surface the ACTUAL error; the hint (when we have one) is
            // appended to it, never substituted for it — a disk-full failure
            // must not be misdiagnosed as an elevation problem.
            let hint = copy_failure_hint(&e, elevated)
                .map(|h| format!(" — {h}"))
                .unwrap_or_default();
            return step_err(
                label,
                format!("couldn't write {}: {e}{hint}", to.display()),
            );
        }
        files += 1;
    }
    step_ok(label, files, format!("{} dll(s) → {}", files, plugins.display()))
}

/// Install the DTH *release* content: `Daz Studio Content/{data,DazToHue}` → the
/// Daz library, and/or `Houdini Assets/*` → the Houdini documents folder,
/// selected by `target` ("daz" / "houdini" / "all"). Native port of the dth-cli
/// `install-daz-dth` / `install-houdini-dth` — now individually runnable.
// `(async)` on every install command: sync commands run on the MAIN thread, and
// these do recursive copies that can take minutes on a network library.
#[tauri::command(async)]
pub fn install_dth_release(request: ReleaseInstallRequest) -> InstallReport {
    let dry = request.dry_run;
    let release_root = Path::new(&request.release_root);
    let daz_content = release_root.join("Daz Studio Content");
    let lib = Path::new(&request.daz_lib_folder);
    let mut steps: Vec<InstallStep> = Vec::new();

    // Daz content (data, DazToHue) → My DAZ 3D Library.
    if request.target != "houdini" {
        for folder in ["data", "DazToHue"] {
            steps.push(install_folder(
                &format!("Daz content: {folder}"),
                &daz_content.join(folder),
                &lib.join(folder),
                dry,
            ));
        }
    }

    // Houdini assets (otls/presets/toolbar/…) → Houdini documents folder (optional).
    if request.target != "daz" {
        if request.houdini_docs_folder.is_empty() {
            steps.push(step_skip("Houdini assets", "Houdini documents folder not set".into()));
        } else {
            steps.push(install_contents(
                "Houdini assets",
                &release_root.join("Houdini Assets"),
                Path::new(&request.houdini_docs_folder),
                dry,
            ));
        }
    }

    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: dry, steps, total_files }
}

/// Install *plugin* DLLs into `<Daz install>/plugins` — the Exporter plugin
/// (default label) or the bundled Runner plugin (its own label). This is the
/// admin-sensitive half — writing into Program Files needs elevation and Daz
/// locks loaded plugin DLLs (see `install_plugin_dlls`).
#[tauri::command(async)]
pub fn install_dth_plugin(request: PluginInstallRequest) -> InstallReport {
    let step = install_plugin_dlls(
        request.label.as_deref().unwrap_or("Exporter plugin"),
        Path::new(&request.exporter_folder),
        Path::new(&request.daz_install_folder),
        request.dry_run,
        // This command runs in the studio's own process — elevated only if the
        // whole app was started that way, which is exactly what `elevate.rs`
        // exists to stop being necessary.
        crate::elevation::is_elevated(),
    );
    let total_files = step.files;
    InstallReport { dry_run: request.dry_run, steps: vec![step], total_files }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MergeInstallRequest {
    label: String,
    source: String,
    dest: String,
    dry_run: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HoudiniPresetsRequest {
    source: String,
    houdini_docs: String,
    dry_run: bool,
}

/// Merge-only install (adds new files, never overwrites) for custom morphs / presets.
#[tauri::command(async)]
pub fn install_daz_merge(request: MergeInstallRequest) -> InstallReport {
    let dry = request.dry_run;
    let src = Path::new(&request.source);
    let dst = Path::new(&request.dest);
    let step = if !src.is_dir() {
        step_skip(&request.label, format!("source not found ({})", src.display()))
    } else if dry {
        step_ok(
            &request.label,
            count_files(src),
            format!("would add new files → {}", dst.display()),
        )
    } else {
        match copy_dir_add_only(src, dst) {
            Ok(stats) => step_ok(
                &request.label,
                stats.files,
                with_link_note(
                    format!("{} new file(s) → {}", stats.files, dst.display()),
                    stats.skipped_links,
                ),
            ),
            Err(e) => step_err(
                &request.label,
                io_detail(&format!("{} → {}", src.display(), dst.display()), &e),
            ),
        }
    };
    let total_files = step.files;
    InstallReport { dry_run: dry, steps: vec![step], total_files }
}

/// Install your Houdini `my_presets` into the Houdini docs folder (overwriting)
/// and wire it into that version's `houdini.env`.
#[tauri::command(async)]
pub fn install_houdini_presets(request: HoudiniPresetsRequest) -> InstallReport {
    let dry = request.dry_run;
    let src = Path::new(&request.source);
    let houdini_docs = Path::new(&request.houdini_docs);
    let mut steps: Vec<InstallStep> = Vec::new();
    if !src.is_dir() {
        steps.push(step_skip("Houdini presets", format!("source not found ({})", src.display())));
    } else {
        let dest = houdini_docs.join(folder_name(src));
        if dry {
            steps.push(step_ok("Houdini presets", count_files(src), format!("would merge → {}", dest.display())));
            steps.push(step_skip("houdini.env", "would wire SHARED_PRESETS + HOUDINI_PATH".into()));
        } else {
            let mut failed = false;
            // MERGE (copy over), never remove-then-copy: the destination folder
            // name is derived from the source basename, so a mis-named source
            // (e.g. "otls") must not wipe an arbitrary Houdini subfolder — and a
            // mid-copy failure must not leave a deleted-then-partial install.
            match copy_dir(src, &dest) {
                Ok(stats) => steps.push(step_ok(
                    "Houdini presets",
                    stats.files,
                    with_link_note(format!("→ {}", dest.display()), stats.skipped_links),
                )),
                Err(e) => {
                    steps.push(step_err("Houdini presets", io_detail(&format!("{} → {}", src.display(), dest.display()), &e)));
                    failed = true;
                }
            }
            if !failed {
                match wire_houdini_env(houdini_docs, &dest) {
                    Ok(true) => steps.push(step_ok("houdini.env", 0, "wired SHARED_PRESETS + HOUDINI_PATH".into())),
                    Ok(false) => steps.push(step_skip("houdini.env", "already wired".into())),
                    Err(e) => steps.push(step_err("houdini.env", io_detail("update houdini.env", &e))),
                }
            }
        }
    }
    let total_files = steps.iter().map(|s| s.files).sum();
    InstallReport { dry_run: dry, steps, total_files }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UnrealInstallRequest {
    /// Release root holding `Unreal Engine Content/DazToHue`.
    release_root: String,
    /// The linked `.uproject` file — content lands in its folder's `Content/DazToHue`.
    uproject_path: String,
    /// Copy over an existing `Content/DazToHue` (the UI's Ctrl+click).
    overwrite: bool,
}

/// The refusal when `Content/DazToHue` already exists and `overwrite` is off.
/// CONTRACT with the UI: apps/web/src/components/unreal-projects-field.tsx
/// matches the "already exists" substring of this message to adopt the
/// installed state over a stale probe — the test below pins the exact phrase so
/// a rewording fails there instead of silently reverting that UI behaviour.
pub(crate) const UNREAL_CONTENT_EXISTS_ERROR: &str =
    "Content/DazToHue already exists in this project — Ctrl+click to overwrite.";

/// Install the release's Unreal Engine content (`Unreal Engine Content/DazToHue`)
/// into the linked project's `Content/DazToHue` — the instant DTH bootstrap for a
/// fresh Unreal project. Refuses when the path isn't a real `.uproject` file,
/// when the release ships no Unreal content, or when the content already exists
/// and `overwrite` is off. Overwrite copies files over — it never deletes first,
/// so project-local additions inside the folder survive. Returns files copied.
#[tauri::command(async)]
pub fn install_unreal_dth(request: UnrealInstallRequest) -> Result<u64, String> {
    let uproject = Path::new(&request.uproject_path);
    let is_uproject = uproject
        .extension()
        .map(|e| e.eq_ignore_ascii_case("uproject"))
        .unwrap_or(false);
    if !is_uproject || !uproject.is_file() {
        return Err("Not an Unreal project file (.uproject).".into());
    }
    let project_dir = uproject
        .parent()
        .ok_or_else(|| "The .uproject has no parent folder.".to_string())?;
    let src = Path::new(&request.release_root)
        .join("Unreal Engine Content")
        .join("DazToHue");
    if !src.is_dir() {
        return Err("This DTH release ships no Unreal Engine Content.".into());
    }
    let dest = project_dir.join("Content").join("DazToHue");
    if dest.exists() && !request.overwrite {
        return Err(UNREAL_CONTENT_EXISTS_ERROR.into());
    }
    // This command returns a bare file count (no step report to carry a
    // skipped-links note) — the links policy still applies via copy_dir.
    copy_dir(&src, &dest).map(|stats| stats.files).map_err(|e| e.to_string())
}

/// Whether a linked Unreal project already carries `Content/DazToHue`. Rust-side
/// on purpose: the JS fs plugin's `exists` proved unreliable for this probe (it
/// silently reported the folder missing on a real project), and this stays
/// symmetric with `install_unreal_dth`'s own path derivation.
// `(async)` even for a probe: `.is_dir()` on an unreachable network project can
// block for seconds — that stall must not happen on the main thread.
#[tauri::command(async)]
pub fn unreal_dth_present(uproject_path: String) -> bool {
    Path::new(&uproject_path)
        .parent()
        .map(|dir| dir.join("Content").join("DazToHue").is_dir())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::unique_temp_dir;

    #[test]
    fn wire_houdini_env_ignores_commented_lines_and_writes_atomically() {
        let docs = unique_temp_dir("houdini_env");
        fs::create_dir_all(&docs).unwrap();
        let env = docs.join("houdini.env");
        // Commented-out lines are NOT wiring — the old substring match counted
        // them, yielding a HOUDINI_PATH referencing an undefined variable.
        fs::write(&env, "# SHARED_PRESETS = \"C:/old\"\nOTHER = 1\n").unwrap();
        let presets = docs.join("my_presets");
        assert!(wire_houdini_env(&docs, &presets).unwrap());
        let content = fs::read_to_string(&env).unwrap();
        assert!(content.contains("\nSHARED_PRESETS = "), "content: {content}");
        assert!(
            content.contains("HOUDINI_PATH = $HOUDINI_PATH;$SHARED_PRESETS"),
            "content: {content}"
        );
        // The user's existing lines survive, and no temp debris is left behind.
        assert!(content.starts_with("# SHARED_PRESETS = \"C:/old\"\nOTHER = 1\n"));
        assert!(!docs.join("houdini.env.dth-tmp").exists());
        // Idempotent: a second run changes nothing.
        assert!(!wire_houdini_env(&docs, &presets).unwrap());
        let _ = fs::remove_dir_all(&docs);
    }

    #[test]
    fn wire_houdini_env_respects_real_uncommented_wiring() {
        let docs = unique_temp_dir("houdini_env_wired");
        fs::create_dir_all(&docs).unwrap();
        let env = docs.join("houdini.env");
        // Spacing/case variants of a REAL definition + reference count as wired.
        let wired = "shared_presets=\"C:/mine\"\nHOUDINI_PATH = $HOUDINI_PATH;$SHARED_PRESETS\n";
        fs::write(&env, wired).unwrap();
        assert!(!wire_houdini_env(&docs, &docs.join("p")).unwrap());
        assert_eq!(fs::read_to_string(&env).unwrap(), wired, "file untouched");
        let _ = fs::remove_dir_all(&docs);
    }

    #[test]
    fn unreal_exists_refusal_pins_the_ui_matched_phrase() {
        // A real refusal: release ships Unreal content, the project already has
        // Content/DazToHue, overwrite off → the command must return EXACTLY the
        // pinned message. unreal-projects-field.tsx matches its 'already exists'
        // substring (see UNREAL_CONTENT_EXISTS_ERROR) — reword both together.
        let root = unique_temp_dir("unreal_exists");
        let release = root.join("release");
        fs::create_dir_all(release.join("Unreal Engine Content").join("DazToHue")).unwrap();
        let project = root.join("proj");
        fs::create_dir_all(project.join("Content").join("DazToHue")).unwrap();
        let uproject = project.join("Game.uproject");
        fs::write(&uproject, "{}").unwrap();

        let err = install_unreal_dth(UnrealInstallRequest {
            release_root: release.to_string_lossy().into_owned(),
            uproject_path: uproject.to_string_lossy().into_owned(),
            overwrite: false,
        })
        .unwrap_err();

        assert_eq!(err, UNREAL_CONTENT_EXISTS_ERROR);
        assert_eq!(
            UNREAL_CONTENT_EXISTS_ERROR,
            "Content/DazToHue already exists in this project — Ctrl+click to overwrite."
        );
        // The load-bearing substring the UI's `message.includes(...)` keys on.
        assert!(UNREAL_CONTENT_EXISTS_ERROR.contains("already exists"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn wire_houdini_env_creates_a_fresh_file() {
        let docs = unique_temp_dir("houdini_env_fresh");
        fs::create_dir_all(&docs).unwrap();
        assert!(wire_houdini_env(&docs, &docs.join("my_presets")).unwrap());
        let content = fs::read_to_string(docs.join("houdini.env")).unwrap();
        assert!(content.starts_with("SHARED_PRESETS = "), "content: {content}");
        assert!(content.contains("$SHARED_PRESETS"), "content: {content}");
        let _ = fs::remove_dir_all(&docs);
    }
}
