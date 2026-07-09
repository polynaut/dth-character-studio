#[cfg(desktop)]
use std::sync::OnceLock;

// --- GitHub API calls (server-side, the webview can't) ------------------------
// The strict CSP lets the webview reach IPC only, so anything that must talk to
// GitHub runs here in Rust. Two callers: the updater dialog's "versions you
// skipped" list (`app_release_tags`) and the DazToHue-Scripts installer's
// version check (`fetch_daztohue_head_sha`, also exposed as `latest_daztohue_commit`).

/// GitHub API for the HEAD commit of soltude/DazToHue-Scripts `main`. With the
/// `.sha` media type the response body IS the 40-char commit SHA (no JSON
/// parsing). Unauthenticated calls are rate-limited to 60/hr per IP — fine for
/// the occasional install/check.
#[cfg(desktop)]
const DAZTOHUE_SCRIPTS_COMMITS_API: &str =
    "https://api.github.com/repos/soltude/DazToHue-Scripts/commits/main";

/// Install ring as the process-default rustls crypto provider, once. reqwest's
/// default Client needs one but the unified build only has rustls' `no-provider`
/// variant (the updater configures its own client), so without this `reqwest::get`
/// panics with "No rustls crypto provider is configured".
#[cfg(desktop)]
pub(crate) fn ensure_crypto_provider() {
    static INIT: OnceLock<()> = OnceLock::new();
    INIT.get_or_init(|| {
        // Err just means another provider was already installed — fine either way.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

/// A reqwest client carrying the app's User-Agent (GitHub rejects UA-less
/// requests) on the updater's already-configured rustls stack (crypto provider
/// installed first). Shared by every GitHub call here.
#[cfg(desktop)]
fn github_client() -> Result<reqwest::Client, String> {
    ensure_crypto_provider();
    reqwest::Client::builder()
        .user_agent("DTH-Character-Studio")
        .build()
        .map_err(|e| format!("http client failed: {e}"))
}

/// The HEAD commit SHA of soltude/DazToHue-Scripts `main`, via the GitHub API. The
/// `.sha` Accept type returns the bare SHA. Errors (offline, 404, rate-limited)
/// surface as a message the caller can show. Used both by the outdated-check
/// command and by the scripts installer (to pin the exact commit it downloads).
#[cfg(desktop)]
pub(crate) async fn fetch_daztohue_head_sha() -> Result<String, String> {
    let client = github_client()?;
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
    let client = github_client()?;
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
