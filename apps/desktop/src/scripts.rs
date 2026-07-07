use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::sync::OnceLock;

#[cfg(desktop)]
use crate::archive::{extract_archive, InflateBudget};
#[cfg(desktop)]
use crate::fsutil::copy_dir;
#[cfg(desktop)]
use crate::report::{io_detail, step_ok};
use crate::report::{one_step_report, step_err, InstallReport};

// --- Tools: download + install the soltude/DazToHue-Scripts repo --------------
// The companion DazToHue-Scripts repo (the runtime the studio co-owns) is fetched
// straight from GitHub and unpacked into `<My DAZ 3D Library>/Scripts/DazToHue-Scripts`.
// The download runs natively (the webview can't — codeload's CORS only allows
// render.githubusercontent.com); reqwest follows the github→codeload redirect.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScriptsInstallRequest {
    /// `<My DAZ 3D Library>/Scripts/DazToHue-Scripts` — where the repo content lands.
    dest: String,
    /// Download + count only, writing nothing into the library.
    dry_run: bool,
}

/// GitHub API for the HEAD commit of `main`. With the `.sha` media type the
/// response body IS the 40-char commit SHA (no JSON parsing). Unauthenticated
/// calls are rate-limited to 60/hr per IP — fine for the occasional install/check.
#[cfg(desktop)]
const DAZTOHUE_SCRIPTS_COMMITS_API: &str =
    "https://api.github.com/repos/soltude/DazToHue-Scripts/commits/main";

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

/// Install ring as the process-default rustls crypto provider, once. reqwest's
/// default Client needs one but the unified build only has rustls' `no-provider`
/// variant (the updater configures its own client), so without this `reqwest::get`
/// panics with "No rustls crypto provider is configured".
#[cfg(desktop)]
fn ensure_crypto_provider() {
    static INIT: OnceLock<()> = OnceLock::new();
    INIT.get_or_init(|| {
        // Err just means another provider was already installed — fine either way.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
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

/// The HEAD commit SHA of soltude/DazToHue-Scripts `main`, via the GitHub API. The
/// `.sha` Accept type returns the bare SHA; GitHub requires a User-Agent. Errors
/// (offline, 404, rate-limited) surface as a message the caller can show.
#[cfg(desktop)]
async fn fetch_daztohue_head_sha() -> Result<String, String> {
    ensure_crypto_provider();
    let client = reqwest::Client::builder()
        .user_agent("DTH-Character-Studio")
        .build()
        .map_err(|e| format!("http client failed: {e}"))?;
    let resp = client
        .get(DAZTOHUE_SCRIPTS_COMMITS_API)
        .header("Accept", "application/vnd.github.sha")
        .send()
        .await
        .map_err(|e| format!("checking the latest version failed: {e}"))?;
    let resp = resp
        .error_for_status()
        .map_err(|e| format!("checking the latest version failed: {e}"))?;
    let sha = resp
        .text()
        .await
        .map_err(|e| format!("reading the version failed: {e}"))?
        .trim()
        .to_string();
    // A valid response is a hex SHA; anything else (an HTML error page, a JSON blob)
    // would poison the marker, so reject it.
    if sha.len() < 7 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(format!("unexpected version response: {sha}"));
    }
    Ok(sha)
}

/// The latest available DazToHue-Scripts commit SHA — for the "is my install
/// outdated?" check. Compared against the `.dth-version.json` marker the installer
/// writes. Returns an error message (not a panic) when the check can't run.
#[cfg(desktop)]
#[tauri::command]
pub async fn latest_daztohue_commit() -> Result<String, String> {
    fetch_daztohue_head_sha().await
}

/// Web/mobile builds have no native HTTP (reqwest is desktop-only).
#[cfg(not(desktop))]
#[tauri::command]
pub async fn latest_daztohue_commit() -> Result<String, String> {
    Err("only available on the desktop app".into())
}

/// Tag names of the app's own GitHub releases, newest first (one page). Feeds
/// the update dialog's "versions you skipped" link list — the webview can't
/// query GitHub itself (the strict CSP allows IPC only). Errors surface as a
/// message; the caller degrades to showing no list.
#[cfg(desktop)]
#[tauri::command]
pub async fn app_release_tags() -> Result<Vec<String>, String> {
    ensure_crypto_provider();
    let client = reqwest::Client::builder()
        .user_agent("DTH-Character-Studio")
        .build()
        .map_err(|e| format!("http client failed: {e}"))?;
    let resp = client
        .get("https://api.github.com/repos/polynaut/dth-character-studio/releases?per_page=30")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("listing releases failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("listing releases failed: {e}"))?;
    #[derive(serde::Deserialize)]
    struct Release {
        tag_name: String,
    }
    let releases: Vec<Release> = resp
        .json()
        .await
        .map_err(|e| format!("reading the releases failed: {e}"))?;
    Ok(releases.into_iter().map(|r| r.tag_name).collect())
}

/// Web/mobile builds have no native HTTP (reqwest is desktop-only).
#[cfg(not(desktop))]
#[tauri::command]
pub async fn app_release_tags() -> Result<Vec<String>, String> {
    Err("only available on the desktop app".into())
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
