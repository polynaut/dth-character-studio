// --- Community product-DB submission (server-side, the webview can't) --------
// The strict CSP lets the webview reach IPC only, so the opt-in product-share
// POST (api/product-share.ts) runs here, on the same reqwest stack as
// github.rs. Fire-and-forget semantics live in TS — this just delivers one
// JSON body and reports the HTTP status.

/// One product-share submission: the payload as pre-serialized JSON, the
/// ingest endpoint and its shared app token. The URL comes from the TS layer's
/// single constant (product-share.ts) rather than being baked here twice; the
/// https guard below keeps this command from being a general HTTP proxy.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRequest {
    pub url: String,
    pub token: String,
    pub body: String,
}

#[cfg(desktop)]
#[tauri::command]
pub async fn submit_product_share(request: ShareRequest) -> Result<u16, String> {
    if !request.url.starts_with("https://") {
        return Err("product-share endpoint must be https".into());
    }
    crate::github::ensure_crypto_provider();
    let client = reqwest::Client::builder()
        .user_agent("DTH-Character-Studio")
        // reqwest defaults to NO timeout — a stalled connection must not pin
        // the (fire-and-forget) submit task forever.
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("http client failed: {e}"))?;
    let resp = client
        .post(&request.url)
        .header("content-type", "application/json")
        .header("x-dth-token", &request.token)
        .body(request.body)
        .send()
        .await
        .map_err(|e| format!("submitting failed: {e}"))?;
    // The status is the answer — 2xx and 4xx alike go back to TS, which decides
    // what counts as delivered (a 200-duplicate is a success there).
    Ok(resp.status().as_u16())
}

/// Web/mobile builds have no native HTTP (reqwest is desktop-only).
#[cfg(not(desktop))]
#[tauri::command]
pub async fn submit_product_share(_request: ShareRequest) -> Result<u16, String> {
    Err("only available on the desktop app".into())
}
