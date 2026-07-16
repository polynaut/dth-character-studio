#[cfg(desktop)]
use std::sync::OnceLock;

// --- GitHub API calls (server-side, the webview can't) ------------------------
// The strict CSP lets the webview reach IPC only, so anything that must talk to
// GitHub runs here in Rust. One caller today: the updater dialog's "versions you
// skipped" list (`app_release_tags`).

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
