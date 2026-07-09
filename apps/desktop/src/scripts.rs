use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(desktop)]
use crate::archive::{extract_archive, InflateBudget};
#[cfg(desktop)]
use crate::fsutil::copy_dir;
#[cfg(desktop)]
use crate::github::{ensure_crypto_provider, fetch_daztohue_head_sha};
#[cfg(desktop)]
use crate::report::{io_detail, step_ok};
use crate::report::{one_step_report, step_err, InstallReport};

// --- Tools: download + install the soltude/DazToHue-Scripts repo --------------
// The companion DazToHue-Scripts repo (the runtime the studio co-owns) is fetched
// straight from GitHub and unpacked into `<My DAZ 3D Library>/Scripts/DazToHue-Scripts`.
// The download runs natively (the webview can't — codeload's CORS only allows
// render.githubusercontent.com); reqwest follows the github→codeload redirect.
// The GitHub-API version check + shared reqwest client live in `github.rs`.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptsInstallRequest {
    /// `<My DAZ 3D Library>/Scripts/DazToHue-Scripts` — where the repo content lands.
    dest: String,
    /// Download + count only, writing nothing into the library.
    dry_run: bool,
}

/// Base for the per-commit source zip: `<base><sha>.zip` downloads exactly that
/// commit's tree, so the installed files always match the SHA we record in the
/// marker. GitHub 302-redirects to codeload; reqwest follows it by default.
#[cfg(desktop)]
const DAZTOHUE_SCRIPTS_ARCHIVE_BASE: &str =
    "https://github.com/soltude/DazToHue-Scripts/archive/";

/// If `dir` holds exactly one entry and it's a folder, return it — GitHub wraps a
/// repo archive in a single `<repo>-<ref>/` folder whose *contents* are installed.
fn single_child_dir(dir: &Path) -> Option<PathBuf> {
    let mut entries = fs::read_dir(dir).ok()?.flatten();
    let first = entries.next()?.path();
    if entries.next().is_some() {
        return None;
    }
    first.is_dir().then_some(first)
}

/// Fetch a URL server-side (following redirects) and return the body bytes.
#[cfg(desktop)]
async fn download_bytes(url: &str) -> Result<Vec<u8>, String> {
    ensure_crypto_provider();
    let resp = reqwest::get(url).await.map_err(|e| format!("download failed: {e}"))?;
    let resp = resp.error_for_status().map_err(|e| format!("download failed: {e}"))?;
    let bytes = resp.bytes().await.map_err(|e| format!("reading the download failed: {e}"))?;
    Ok(bytes.to_vec())
}

/// Download the soltude/DazToHue-Scripts repo as a zip and install its contents
/// into `dest`. The archive is fetched in memory, unpacked into a temp folder
/// beside `dest`, then swapped in — so a failed download/extract never leaves a
/// half-written install. GitHub's top-level wrapper folder is stripped so the repo
/// files land directly in `dest`. `dry_run` downloads + counts only.
#[cfg(desktop)]
#[tauri::command]
pub async fn install_daztohue_scripts(request: ScriptsInstallRequest) -> InstallReport {
    let dry = request.dry_run;
    let dest = PathBuf::from(&request.dest);
    let label = "DazToHue-Scripts";

    // Resolve the exact HEAD commit first, then download that commit's tree — so the
    // installed files always match the SHA we record (no branch-moved-under-us race).
    let sha = match fetch_daztohue_head_sha().await {
        Ok(s) => s,
        Err(msg) => return one_step_report(dry, step_err(label, msg)),
    };
    let zip_url = format!("{DAZTOHUE_SCRIPTS_ARCHIVE_BASE}{sha}.zip");
    let short = &sha[..7.min(sha.len())];

    let bytes = match download_bytes(&zip_url).await {
        Ok(b) => b,
        Err(msg) => return one_step_report(dry, step_err(label, msg)),
    };
    // Decompression-bomb rail for the downloaded archive: ratio-based inflate
    // budget derived from the compressed download size (+ an entry-count cap,
    // both enforced inside extract_archive).
    let mut budget = InflateBudget::new(format!("the {label} download ({short})"), bytes.len() as u64);
    let mut archive = match zip::ZipArchive::new(std::io::Cursor::new(bytes)) {
        Ok(a) => a,
        Err(e) => return one_step_report(dry, step_err(label, format!("unzip failed: {e}"))),
    };
    // Count file entries (drop each ZipFile before the next borrow — see process_zip_asset).
    let mut file_count = 0u64;
    for i in 0..archive.len() {
        if let Ok(entry) = archive.by_index(i) {
            if !entry.is_dir() {
                file_count += 1;
            }
        }
    }

    if dry {
        return one_step_report(
            dry,
            step_ok(
                label,
                file_count,
                format!("would install {file_count} file(s) at {short} → {}", dest.display()),
            ),
        );
    }

    // Unpack into a temp folder beside dest (same drive → instant final move).
    let parent = dest.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let tmp = parent.join(".DazToHue-Scripts.download");
    let _ = fs::remove_dir_all(&tmp);
    if let Err(e) = fs::create_dir_all(&tmp) {
        return one_step_report(dry, step_err(label, io_detail("create temp folder", &e)));
    }
    if let Err(e) = extract_archive(&mut archive, &tmp, &mut budget) {
        // Never leave a partial extraction behind (e.g. on a bomb-budget breach).
        let _ = fs::remove_dir_all(&tmp);
        return one_step_report(dry, step_err(label, io_detail("extract", &e)));
    }
    let content_root = single_child_dir(&tmp).unwrap_or_else(|| tmp.clone());

    if let Some(p) = dest.parent() {
        let _ = fs::create_dir_all(p);
    }
    // Swap, don't remove-then-move: move any previous install ASIDE first, put the
    // fresh content in place, and only then delete the old copy — so a failure
    // during the move never leaves the user with no install (the old one is
    // restored). Avoids the deleted-then-partial window.
    let backup = dest.with_file_name(".DazToHue-Scripts.prev");
    let _ = fs::remove_dir_all(&backup);
    let had_old = dest.exists();
    if had_old {
        if let Err(e) = fs::rename(&dest, &backup) {
            let _ = fs::remove_dir_all(&tmp);
            return one_step_report(dry, step_err(label, io_detail("move previous install aside", &e)));
        }
    }
    let moved = fs::rename(&content_root, &dest).is_ok() || copy_dir(&content_root, &dest).is_ok();
    if moved {
        let _ = fs::remove_dir_all(&backup);
    } else if had_old {
        // New content didn't land — restore the previous install so nothing is lost.
        let _ = fs::rename(&backup, &dest);
    }
    let _ = fs::remove_dir_all(&tmp);
    if moved {
        // Record the installed commit so the Tools tab can flag when it's outdated.
        // `sha` is validated hex + `ref` is a literal, so hand-formatting the JSON is
        // safe (no escaping needed) and avoids a serde_json dependency here.
        let marker = dest.join(".dth-version.json");
        let _ = fs::write(&marker, format!("{{\"commit\":\"{sha}\",\"ref\":\"main\"}}"));
        one_step_report(dry, step_ok(label, file_count, format!("{short} → {}", dest.display())))
    } else {
        one_step_report(dry, step_err(label, format!("couldn't move files into {}", dest.display())))
    }
}

/// Web/mobile builds have no native download (reqwest is desktop-only).
#[cfg(not(desktop))]
#[tauri::command]
pub async fn install_daztohue_scripts(_request: ScriptsInstallRequest) -> InstallReport {
    one_step_report(false, step_err("DazToHue-Scripts", "only available on the desktop app".into()))
}
