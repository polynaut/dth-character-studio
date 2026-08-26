use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

// --- Owning product of a file, from the DIM install manifests ---------------
// The DAZ Install Manager keeps one `.dsx` XML per installed package in each
// ManifestFiles folder, listing every file that package installed (`<File …
// VALUE="Content/Runtime/Textures/…"/>`) next to the product's name and store
// SKU. Searching those manifests for a missing baker texture turns the
// dead-end "reinstall the product" into an actionable product name — the same
// database runtime v104's Daz-side product scan reads, but searched here
// natively so the Utils drawer can answer without a Daz round trip.
//
// Matched on the file's PARENT FOLDER + name, never the bare file name: base
// names collide hard across the Daz store (`Torso_D.jpg`, `01_Bump.jpg` ship
// in dozens of products) and naming the WRONG product is worse than the
// generic advice it replaces. A package installs to the same relative layout
// the scene then records, so the last two segments pair the two sides.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimOwnersRequest {
    /// Every configured ManifestFiles folder (primary + extras) — the TS side
    /// resolves the list (`dimManifestsFolderList`); an unreadable folder is
    /// skipped, not an error (an unmounted network drive must not take the
    /// lookup down).
    pub manifests_folders: Vec<String>,
    /// Full paths of the files to find owners for, as the scan recorded them.
    pub paths: Vec<String>,
}

#[derive(Serialize)]
#[cfg_attr(test, derive(serde::Deserialize, Debug, PartialEq))]
#[serde(rename_all = "camelCase")]
pub struct DimOwner {
    /// The searched path, echoed back exactly as it was passed in — the caller
    /// pairs its own rows on it, so nothing here re-spells it.
    pub path: String,
    /// The owning product, from the first manifest that lists the file.
    pub product_name: String,
    /// The store SKU (`ProductStoreIDX`, falling back to `ProductID`);
    /// '' when the manifest names neither.
    pub sku: String,
}

/// Two bytes the same, ignoring ASCII case and reading `\` as `/` — the two
/// ways the same installed file is spelled on either side of this lookup.
fn same_byte(a: u8, b: u8) -> bool {
    let norm = |c: u8| if c == b'\\' { b'/' } else { c.to_ascii_lowercase() };
    norm(a) == norm(b)
}

/// Does `needle` sit at `at` in `hay`, under [`same_byte`]?
fn matches_at(hay: &[u8], at: usize, needle: &[u8]) -> bool {
    hay.len() >= at + needle.len()
        && needle.iter().zip(&hay[at..]).all(|(n, h)| same_byte(*n, *h))
}

/// `str::find`, ignoring ASCII case. Every offset it returns starts on an
/// ASCII byte, so callers can slice the `&str` with it.
fn find_ci(hay: &str, needle: &str) -> Option<usize> {
    let (h, n) = (hay.as_bytes(), needle.as_bytes());
    if n.is_empty() || h.len() < n.len() {
        return None;
    }
    (0..=h.len() - n.len()).find(|&i| matches_at(h, i, n))
}

/// What a manifest has to list for this path: the file name behind its PARENT
/// FOLDER (`raiya/rypi5_torso1.jpg`), or the bare name when the path has no
/// folder. Separators come out `/`; the match itself is separator-blind.
fn search_tail(path: &str) -> String {
    let segments: Vec<&str> = path
        .split(['/', '\\'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    match segments.len() {
        0 => String::new(),
        1 => segments[0].to_string(),
        n => format!("{}/{}", segments[n - 2], segments[n - 1]),
    }
}

/// Does this manifest list a file at `tail`? True only at a path boundary —
/// the tail must be preceded by `/`, `\` or `"` and followed by `"` — so
/// `raiya/hair.jpg` matches neither `…/raiya/LongHair.jpg` nor a folder called
/// `xraiya`. Scans the RAW bytes: a manifests folder is thousands of files and
/// a lowercased copy of each one is the whole cost of this lookup.
fn lists_file(content: &str, tail: &str) -> bool {
    let hay = content.as_bytes();
    let needle = tail.as_bytes();
    if needle.is_empty() || hay.len() < needle.len() {
        return false;
    }
    for at in 0..=hay.len() - needle.len() {
        if !matches_at(hay, at, needle) {
            continue;
        }
        let before_ok = at > 0 && matches!(hay[at - 1], b'/' | b'\\' | b'"');
        let after_ok = hay.get(at + needle.len()) == Some(&b'"');
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

/// The value of `<tag VALUE="…"/>` (DIM's attribute form) or `<tag>…</tag>`,
/// matched case-insensitively; None when the tag isn't there.
fn xml_tag_value(content: &str, tag: &str) -> Option<String> {
    let hay = content.as_bytes();
    let open = format!("<{tag}");
    let open_bytes = open.as_bytes();
    let mut from = 0;
    while from + open_bytes.len() <= hay.len() {
        let found = (from..=hay.len() - open_bytes.len())
            .find(|&i| matches_at(hay, i, open_bytes))?;
        let at = found + open_bytes.len();
        // The tag name must end here (not match a longer tag's prefix).
        if !matches!(hay.get(at), Some(b' ') | Some(b'\t') | Some(b'>') | Some(b'/')) {
            from = at;
            continue;
        }
        let end = at + hay[at..].iter().position(|&c| c == b'>')?;
        let head = &content[at..end];
        // Attribute form first — it is what DIM actually writes.
        if let Some(v) = find_ci(head, "value=\"") {
            let start = at + v + "value=\"".len();
            let close = start + hay[start..].iter().position(|&c| c == b'"')?;
            return Some(content[start..close].trim().to_string());
        }
        // Element form: <tag>text</tag>.
        if !head.ends_with('/') {
            let text_start = end + 1;
            if let Some(rel) = find_ci(&content[text_start..], &format!("</{tag}>")) {
                let text = content[text_start..text_start + rel].trim();
                if !text.is_empty() {
                    return Some(text.to_string());
                }
            }
        }
        from = end + 1;
    }
    None
}

/// Search every configured DIM manifests folder for the owners of the given
/// paths. First manifest that lists a path's tail AND names its product wins
/// for that path; a path no manifest knows simply has no entry in the result.
/// Best-effort throughout — unreadable folders/files are skipped.
#[tauri::command(async)]
pub fn find_dim_owners(request: DimOwnersRequest) -> Vec<DimOwner> {
    // One search per distinct tail, carrying every path that shares it — the
    // same file under two library roots is one manifest read, two answers.
    let mut wanted: Vec<(String, Vec<String>)> = Vec::new();
    for path in request.paths {
        let asked = path.trim().to_string();
        let tail = search_tail(&asked);
        if tail.is_empty() {
            continue;
        }
        match wanted.iter_mut().find(|(t, _)| t.eq_ignore_ascii_case(&tail)) {
            Some((_, paths)) => {
                if !paths.contains(&asked) {
                    paths.push(asked);
                }
            }
            None => wanted.push((tail, vec![asked])),
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
            let hits: Vec<usize> = wanted
                .iter()
                .enumerate()
                .filter(|(_, (tail, _))| lists_file(&content, tail))
                .map(|(i, _)| i)
                .collect();
            if hits.is_empty() {
                continue;
            }
            // A manifest that lists the file but names no product cannot answer
            // — leave the path wanted, a later manifest may claim it too.
            let Some(product_name) = xml_tag_value(&content, "ProductName") else {
                continue;
            };
            if product_name.is_empty() {
                continue;
            }
            let sku = xml_tag_value(&content, "ProductStoreIDX")
                .or_else(|| xml_tag_value(&content, "ProductID"))
                .unwrap_or_default();
            // Highest index first, so each remove leaves the earlier ones valid.
            for i in hits.into_iter().rev() {
                let (_, asked) = wanted.remove(i);
                for path in asked {
                    owners.push(DimOwner {
                        path,
                        product_name: product_name.clone(),
                        sku: sku.clone(),
                    });
                }
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

    fn lookup(folders: &[String], paths: &[&str]) -> Vec<DimOwner> {
        find_dim_owners(DimOwnersRequest {
            manifests_folders: folders.to_vec(),
            paths: paths.iter().map(|p| p.to_string()).collect(),
        })
    }

    fn one(dir: &Path) -> Vec<String> {
        vec![dir.to_string_lossy().into_owned()]
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
        let asked = "e:/daz 3d/my library/runtime/textures/daz/g9/g9feminine01_nails_d_1005.jpg";
        let owners = lookup(&one(&dir), &[asked]);
        assert_eq!(
            owners,
            vec![DimOwner {
                path: asked.into(),
                product_name: "Genesis 9 Starter Essentials".into(),
                sku: "86268-1".into(),
            }]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn matches_case_and_separator_blind_but_echoes_the_asked_path() {
        let dir = unique_temp_dir("dim_case");
        write_manifests(
            &dir,
            &[(
                "IM1-1_P.dsx",
                manifest(Some("Some Skin"), "1", &["Content/Runtime/Textures/V/TORSO1.JPG"]),
            )],
        );
        let asked = "D:\\Lib\\Runtime\\Textures\\v\\torso1.jpg";
        let owners = lookup(&one(&dir), &[asked]);
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].path, asked);
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
        assert!(lookup(&one(&dir), &["d:/lib/runtime/textures/v/hair.jpg"]).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_parent_folder_has_to_match_so_a_shared_base_name_cannot_mis_name_a_product() {
        // Why the tail is two segments: `Torso_D.jpg` ships in dozens of
        // products, and naming the wrong one is worse than the generic advice.
        let dir = unique_temp_dir("dim_parent");
        write_manifests(
            &dir,
            &[(
                "IM8-1_Other.dsx",
                manifest(
                    Some("Other Vendor Skin"),
                    "8",
                    &["Content/Runtime/Textures/Other/Torso_D.jpg"],
                ),
            )],
        );
        let folders = one(&dir);
        assert!(lookup(&folders, &["d:/lib/runtime/textures/raiya/Torso_D.jpg"]).is_empty());
        // The same name under the folder the package installed it to matches.
        let owners = lookup(&folders, &["d:/lib/runtime/textures/other/torso_d.jpg"]);
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].product_name, "Other Vendor Skin");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_bare_file_name_still_searches_on_the_name_alone() {
        let dir = unique_temp_dir("dim_bare");
        write_manifests(
            &dir,
            &[("IM9-1_Bare.dsx", manifest(Some("Bare"), "9", &["Content/loose.jpg"]))],
        );
        let owners = lookup(&one(&dir), &["loose.jpg"]);
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].product_name, "Bare");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_paths_sharing_one_tail_both_get_the_answer() {
        let dir = unique_temp_dir("dim_shared_tail");
        write_manifests(
            &dir,
            &[(
                "IMA-1_S.dsx",
                manifest(Some("Shared"), "10", &["Content/Runtime/Textures/s/t.jpg"]),
            )],
        );
        let owners = lookup(
            &one(&dir),
            &["d:/one/runtime/textures/s/t.jpg", "e:/two/runtime/textures/s/t.jpg"],
        );
        assert_eq!(owners.len(), 2);
        assert!(owners.iter().all(|o| o.product_name == "Shared"));
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
        let owners = lookup(&one(&dir), &["d:/lib/runtime/textures/x/tex.jpg"]);
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
        let owners = lookup(
            &one(&dir),
            &["d:/lib/runtime/textures/a/old.jpg", "d:/lib/data/b/none.dsf"],
        );
        let old = owners.iter().find(|o| o.path.ends_with("old.jpg")).unwrap();
        assert_eq!(old.sku, "555");
        let none = owners.iter().find(|o| o.path.ends_with("none.dsf")).unwrap();
        assert_eq!(none.sku, "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_non_ascii_product_name_survives_the_case_insensitive_search() {
        // The matcher folds ASCII case on the RAW bytes. Nothing re-indexes the
        // content through a lowercased copy, whose byte offsets can drift from
        // the original's (`İ` is 2 bytes, its lowercase 3) and hand back a
        // slice that is wrong rather than absent.
        let dir = unique_temp_dir("dim_unicode");
        write_manifests(
            &dir,
            &[(
                "IMB-1_U.dsx",
                manifest(
                    Some("İstanbul Éclair — Skins"),
                    "11",
                    &["Content/Runtime/Textures/u/u.jpg"],
                ),
            )],
        );
        let owners = lookup(&one(&dir), &["d:/lib/runtime/textures/u/u.jpg"]);
        assert_eq!(owners.len(), 1);
        assert_eq!(owners[0].product_name, "İstanbul Éclair — Skins");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unknown_files_and_unreadable_folders_answer_with_nothing() {
        let dir = unique_temp_dir("dim_missing");
        write_manifests(&dir, &[("IM5-1_E.dsx", manifest(Some("P"), "9", &["Content/a/b.jpg"]))]);
        let owners = lookup(
            &[
                "Z:/no/such/manifests/folder".to_string(),
                dir.to_string_lossy().into_owned(),
            ],
            &["d:/lib/x/never-installed.jpg", "", "   "],
        );
        assert!(owners.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn extra_folders_are_searched_after_the_primary() {
        let primary = unique_temp_dir("dim_primary");
        let extra = unique_temp_dir("dim_extra");
        write_manifests(
            &primary,
            &[("IM6-1_F.dsx", manifest(Some("A"), "1", &["Content/x/a.jpg"]))],
        );
        write_manifests(
            &extra,
            &[("IM7-1_G.dsx", manifest(Some("B"), "2", &["Content/y/b.jpg"]))],
        );
        let owners = lookup(
            &[
                primary.to_string_lossy().into_owned(),
                extra.to_string_lossy().into_owned(),
            ],
            &["d:/lib/x/a.jpg", "d:/lib/y/b.jpg"],
        );
        assert_eq!(owners.len(), 2);
        assert!(owners.iter().any(|o| o.product_name == "A"));
        assert!(owners.iter().any(|o| o.product_name == "B"));
        let _ = std::fs::remove_dir_all(&primary);
        let _ = std::fs::remove_dir_all(&extra);
    }
}
