use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

// --- Owning product of a file, from the DIM install manifests ---------------
// The DAZ Install Manager keeps one `.dsx` XML per installed package in each
// ManifestFiles folder, listing every file that package installed (`<File …
// VALUE="Content/Runtime/Textures/…"/>`) next to the product's name and store
// SKU. Searching those manifests for a missing baker texture's file name turns
// the dead-end "reinstall the product" into an actionable product name — the
// same database runtime v104's Daz-side product scan reads, but searched here
// natively so the Utils drawer can answer without a Daz round trip.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimOwnersRequest {
    /// Every configured ManifestFiles folder (primary + extras) — the TS side
    /// resolves the list (`dimManifestsFolderList`); an unreadable folder is
    /// skipped, not an error (an unmounted network drive must not take the
    /// lookup down).
    pub manifests_folders: Vec<String>,
    /// File names (basenames) to find owners for.
    pub file_names: Vec<String>,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize, Debug, PartialEq))]
#[serde(rename_all = "camelCase")]
pub struct DimOwner {
    /// The searched file name, exactly as it was passed in.
    pub file_name: String,
    /// The owning product, from the first manifest that lists the file.
    pub product_name: String,
    /// The store SKU (`ProductStoreIDX`, falling back to `ProductID`);
    /// '' when the manifest names neither.
    pub sku: String,
}

/// A `lower`-derived byte range read back out of the ORIGINAL content, for its
/// real casing. Unicode lowercasing can shift byte offsets (rare, non-ASCII),
/// so an offset that no longer lands on the original's char boundaries falls
/// back to the lowercased text instead of panicking.
fn original_slice(content: &str, lower: &str, start: usize, end: usize) -> String {
    content.get(start..end).unwrap_or(&lower[start..end]).trim().to_string()
}

/// The value of `<tag VALUE="…"/>` (DIM's attribute form) or `<tag>…</tag>`,
/// matched case-insensitively; None when the tag isn't there.
fn xml_tag_value(content: &str, lower: &str, tag: &str) -> Option<String> {
    let tag_lower = tag.to_lowercase();
    // Attribute form first — it is what DIM actually writes.
    let open = format!("<{tag_lower}");
    let mut from = 0;
    while let Some(rel) = lower[from..].find(&open) {
        let at = from + rel + open.len();
        // The tag name must end here (not match a longer tag's prefix).
        match lower.as_bytes().get(at) {
            Some(b' ') | Some(b'>') | Some(b'/') => {}
            _ => {
                from = at;
                continue;
            }
        }
        let end = lower[at..].find('>').map(|i| at + i)?;
        let head = &lower[at..end];
        if let Some(v) = head.find("value=\"") {
            let start = at + v + "value=\"".len();
            let close = lower[start..].find('"').map(|i| start + i)?;
            return Some(original_slice(content, lower, start, close));
        }
        // Element form: <tag>text</tag>.
        if !head.ends_with('/') {
            let text_start = end + 1;
            let close_tag = format!("</{tag_lower}>");
            if let Some(rel_close) = lower[text_start..].find(&close_tag) {
                let text = original_slice(content, lower, text_start, text_start + rel_close);
                if !text.is_empty() {
                    return Some(text);
                }
            }
        }
        from = end + 1;
    }
    None
}

/// Does this manifest list a file with this (lowercase) basename? True only at
/// a path boundary — the name must be preceded by `/`, `\` or `"` and followed
/// by `"`, so `hair.jpg` never matches `LongHair.jpg`.
fn lists_file(lower: &str, name_lower: &str) -> bool {
    let bytes = lower.as_bytes();
    let mut from = 0;
    while let Some(rel) = lower[from..].find(name_lower) {
        let at = from + rel;
        let before_ok = at > 0 && matches!(bytes[at - 1], b'/' | b'\\' | b'"');
        let after_ok = bytes.get(at + name_lower.len()) == Some(&b'"');
        if before_ok && after_ok {
            return true;
        }
        from = at + name_lower.len();
    }
    false
}

/// Search every configured DIM manifests folder for the owners of the given
/// file names. First manifest that lists a file AND names its product wins for
/// that file; a file no manifest knows simply has no entry in the result.
/// Best-effort throughout — unreadable folders/files are skipped.
#[tauri::command(async)]
pub fn find_dim_owners(request: DimOwnersRequest) -> Vec<DimOwner> {
    // (lowercase name, original) — deduped case-insensitively, empties dropped.
    let mut wanted: Vec<(String, String)> = Vec::new();
    for name in request.file_names {
        let trimmed = name.trim().to_string();
        let lower = trimmed.to_lowercase();
        if !lower.is_empty() && !wanted.iter().any(|(l, _)| *l == lower) {
            wanted.push((lower, trimmed));
        }
    }

    let mut owners = Vec::new();
    for folder in &request.manifests_folders {
        if wanted.is_empty() {
            break;
        }
        let Ok(entries) = fs::read_dir(Path::new(folder)) else {
            continue;
        };
        for entry in entries.flatten() {
            if wanted.is_empty() {
                break;
            }
            let path = entry.path();
            if !path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("dsx"))
            {
                continue;
            }
            let Ok(raw) = fs::read(&path) else { continue };
            let content = String::from_utf8_lossy(&raw);
            let lower = content.to_lowercase();
            let hits: Vec<usize> = wanted
                .iter()
                .enumerate()
                .filter(|(_, (name_lower, _))| lists_file(&lower, name_lower))
                .map(|(i, _)| i)
                .collect();
            if hits.is_empty() {
                continue;
            }
            // A manifest that lists the file but names no product cannot answer
            // — leave the name wanted, a later manifest may claim it too.
            let Some(product_name) = xml_tag_value(&content, &lower, "ProductName") else {
                continue;
            };
            if product_name.is_empty() {
                continue;
            }
            let sku = xml_tag_value(&content, &lower, "ProductStoreIDX")
                .or_else(|| xml_tag_value(&content, &lower, "ProductID"))
                .unwrap_or_default();
            // Highest index first, so each remove leaves the earlier ones valid.
            for i in hits.into_iter().rev() {
                let (_, original) = wanted.remove(i);
                owners.push(DimOwner {
                    file_name: original,
                    product_name: product_name.clone(),
                    sku: sku.clone(),
                });
            }
        }
    }
    owners
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::unique_temp_dir;

    fn manifest(product: Option<&str>, sku: &str, files: &[&str]) -> String {
        let mut xml = String::from("<DAZInstallManifest VERSION=\"0.1\">\n");
        if let Some(name) = product {
            xml.push_str(&format!(" <ProductName VALUE=\"{name}\"/>\n"));
        }
        if !sku.is_empty() {
            xml.push_str(&format!(" <ProductStoreIDX VALUE=\"{sku}\"/>\n"));
        }
        for file in files {
            xml.push_str(&format!(
                " <File TARGET=\"Content\" ACTION=\"Install\" VALUE=\"{file}\"/>\n"
            ));
        }
        xml.push_str("</DAZInstallManifest>\n");
        xml
    }

    fn write_manifests(dir: &Path, manifests: &[(&str, String)]) {
        std::fs::create_dir_all(dir).unwrap();
        for (name, content) in manifests {
            std::fs::write(dir.join(name), content).unwrap();
        }
    }

    fn lookup(folders: Vec<String>, names: &[&str]) -> Vec<DimOwner> {
        find_dim_owners(DimOwnersRequest {
            manifests_folders: folders,
            file_names: names.iter().map(|n| n.to_string()).collect(),
        })
    }

    #[test]
    fn names_the_owning_product_with_its_sku() {
        let dir = unique_temp_dir("dim_basic");
        write_manifests(
            &dir,
            &[(
                "IM00086268-01_G9Essentials.dsx",
                manifest(
                    Some("Genesis 9 Starter Essentials"),
                    "86268-1",
                    &["Content/Runtime/Textures/DAZ/G9/G9Feminine01_Nails_D_1005.jpg"],
                ),
            )],
        );
        let owners = lookup(
            vec![dir.to_string_lossy().into_owned()],
            &["G9Feminine01_Nails_D_1005.jpg"],
        );
        assert_eq!(
            owners,
            vec![DimOwner {
                file_name: "G9Feminine01_Nails_D_1005.jpg".into(),
                product_name: "Genesis 9 Starter Essentials".into(),
                sku: "86268-1".into(),
            }]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn matches_case_insensitively_but_returns_the_asked_name() {
        let dir = unique_temp_dir("dim_case");
        write_manifests(
            &dir,
            &[(
                "IM1-1_P.dsx",
                manifest(Some("Some Skin"), "1", &["Content/Runtime/Textures/V/TORSO1.JPG"]),
            )],
        );
        let owners = lookup(vec![dir.to_string_lossy().into_owned()], &["torso1.jpg"]);
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].file_name, "torso1.jpg");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_longer_file_name_containing_the_searched_one_is_not_a_match() {
        let dir = unique_temp_dir("dim_boundary");
        write_manifests(
            &dir,
            &[(
                "IM2-1_P.dsx",
                manifest(Some("Long Hair"), "2", &["Content/Runtime/Textures/V/LongHair.jpg"]),
            )],
        );
        assert!(lookup(vec![dir.to_string_lossy().into_owned()], &["hair.jpg"]).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_manifest_without_a_product_name_does_not_claim_the_file() {
        let dir = unique_temp_dir("dim_nameless");
        // The nameless manifest sorts first; the named one must still answer.
        write_manifests(
            &dir,
            &[
                ("IM1-1_A.dsx", manifest(None, "", &["Content/Runtime/Textures/x/tex.jpg"])),
                (
                    "IM2-1_B.dsx",
                    manifest(Some("Real Product"), "7", &["Content/Runtime/Textures/x/tex.jpg"]),
                ),
            ],
        );
        let owners = lookup(vec![dir.to_string_lossy().into_owned()], &["tex.jpg"]);
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].product_name, "Real Product");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn sku_falls_back_to_product_id_and_then_to_empty() {
        let dir = unique_temp_dir("dim_sku");
        let with_id = concat!(
            "<DAZInstallManifest>\n",
            " <ProductName VALUE=\"Old Pack\"/>\n",
            " <ProductID VALUE=\"555\"/>\n",
            " <File VALUE=\"Content/Runtime/Textures/a/old.jpg\"/>\n",
            "</DAZInstallManifest>\n"
        );
        write_manifests(
            &dir,
            &[
                ("IM3-1_C.dsx", with_id.to_string()),
                ("IM4-1_D.dsx", manifest(Some("No Sku"), "", &["Content/data/b/none.dsf"])),
            ],
        );
        let owners = lookup(vec![dir.to_string_lossy().into_owned()], &["old.jpg", "none.dsf"]);
        let old = owners.iter().find(|o| o.file_name == "old.jpg").unwrap();
        assert_eq!(old.sku, "555");
        let none = owners.iter().find(|o| o.file_name == "none.dsf").unwrap();
        assert_eq!(none.sku, "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_files_and_unreadable_folders_answer_with_nothing() {
        let dir = unique_temp_dir("dim_missing");
        write_manifests(&dir, &[("IM5-1_E.dsx", manifest(Some("P"), "9", &["Content/a/b.jpg"]))]);
        let owners = lookup(
            vec![
                "Z:/no/such/manifests/folder".into(),
                dir.to_string_lossy().into_owned(),
            ],
            &["never-installed.jpg", ""],
        );
        assert!(owners.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extra_folders_are_searched_after_the_primary() {
        let primary = unique_temp_dir("dim_primary");
        let extra = unique_temp_dir("dim_extra");
        write_manifests(&primary, &[("IM6-1_F.dsx", manifest(Some("A"), "1", &["Content/a/a.jpg"]))]);
        write_manifests(&extra, &[("IM7-1_G.dsx", manifest(Some("B"), "2", &["Content/b/b.jpg"]))]);
        let owners = lookup(
            vec![
                primary.to_string_lossy().into_owned(),
                extra.to_string_lossy().into_owned(),
            ],
            &["a.jpg", "b.jpg"],
        );
        assert_eq!(owners.len(), 2);
        assert!(owners.iter().any(|o| o.product_name == "A"));
        assert!(owners.iter().any(|o| o.product_name == "B"));
        let _ = std::fs::remove_dir_all(&primary);
        let _ = std::fs::remove_dir_all(&extra);
    }
}
