use std::collections::{BTreeSet, HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};

// Daz content folders an asset contributes to the library; Documentation is a
// fallback when none of the real content folders are present.
pub(crate) const CONTENT_FOLDERS: [&str; 3] = ["data", "People", "Runtime"];
pub(crate) const META_FOLDERS: [&str; 1] = ["Documentation"];

/// Find the directory under `root` (within `depth` levels) that holds Daz content
/// folders, plus the folder names found. Daz assets keep these at the root or a
/// folder or two down (esp. inside zips).
///
/// Real content folders (`data`/`People`/`Runtime`) found at ANY depth take precedence
/// over a metadata-only (`Documentation`) folder at a *shallower* level. Products are
/// routinely packaged as a top-level `Documentation/` beside a `My Library/` (or
/// `Content/`) wrapper that holds the real `data`/`Runtime` — installing the readme
/// while skipping the wrapper would leave the morphs uninstalled. Only when there is
/// no real content anywhere within `depth` does a Documentation-only level win, so a
/// docs-only asset still reports as installed rather than "no content".
///
/// ONE content root is resolved: the search is breadth-first, so the SHALLOWEST
/// directory that directly contains content folders wins (ties broken by listing
/// order). An asset that ships content under MULTIPLE separate roots resolves
/// only to that first root — the whole install/dedup pipeline assumes a single
/// content root per asset (a union across roots is not supported).
pub(crate) fn find_content_level(root: &Path, depth: u32) -> Option<(PathBuf, Vec<String>)> {
    find_dir_level(root, depth, &CONTENT_FOLDERS)
        .or_else(|| find_dir_level(root, depth, &META_FOLDERS))
}

/// The SHALLOWEST directory under `root` (within `depth` levels) that *directly*
/// contains one of `wanted`, plus the matching names in `wanted` order.
/// Breadth-first — the old depth-first search let an earlier sibling's DEEPER
/// match beat a later sibling's shallower one; ties at the same depth go to
/// listing order.
fn find_dir_level(root: &Path, depth: u32, wanted: &[&str]) -> Option<(PathBuf, Vec<String>)> {
    let mut queue: VecDeque<(PathBuf, u32)> = VecDeque::from([(root.to_path_buf(), depth)]);
    while let Some((dir, depth)) = queue.pop_front() {
        let here: Vec<String> =
            wanted.iter().filter(|n| dir.join(n).is_dir()).map(|n| (*n).to_string()).collect();
        if !here.is_empty() {
            return Some((dir, here));
        }
        if depth == 0 {
            continue;
        }
        for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
            let p = entry.path();
            if p.is_dir() {
                queue.push_back((p, depth - 1));
            }
        }
    }
    None
}

/// The directory *inside a zip* (within 5 levels) that *directly* contains one of
/// `wanted`, plus the matching names — the archive equivalent of `find_dir_level`,
/// computed purely from the central-directory entry paths (no extraction).
pub(crate) fn zip_dir_level(paths: &[&str], wanted: &[&str]) -> Option<(String, Vec<String>)> {
    // Map each directory in the archive to its immediate child directory names.
    let mut children: HashMap<String, BTreeSet<String>> = HashMap::new();
    for p in paths {
        let comps: Vec<&str> = p.split('/').filter(|c| !c.is_empty()).collect();
        // The last component is the file name; the rest are directories.
        for i in 0..comps.len().saturating_sub(1) {
            let parent = comps[..i].join("/");
            children.entry(parent).or_default().insert(comps[i].to_string());
        }
    }
    // Case-insensitive like the folder walk (NTFS resolves `DATA` and `data` to
    // the same library folder, and archives are cased however the author zipped
    // them). Returns the ACTUAL entry casing so callers can prefix-match the
    // archive's own paths — install/extraction then preserves that casing.
    fn folders_in(
        dir: &str,
        children: &HashMap<String, BTreeSet<String>>,
        wanted: &[&str],
    ) -> Vec<String> {
        match children.get(dir) {
            Some(kids) => wanted
                .iter()
                .flat_map(|f| {
                    kids.iter().filter(|k| k.to_lowercase() == f.to_lowercase()).cloned()
                })
                .collect(),
            None => Vec::new(),
        }
    }
    // Breadth-first, like `find_dir_level`: the SHALLOWEST matching directory
    // wins (ties at the same depth go to BTreeSet — lexicographic — order); the
    // old depth-first search let an earlier sibling's deeper match beat a later
    // sibling's shallower one.
    let mut queue: VecDeque<(String, u32)> = VecDeque::from([(String::new(), 5u32)]);
    while let Some((dir, depth)) = queue.pop_front() {
        let here = folders_in(&dir, &children, wanted);
        if !here.is_empty() {
            return Some((dir, here));
        }
        if depth == 0 {
            continue;
        }
        if let Some(kids) = children.get(&dir) {
            for k in kids {
                let sub = if dir.is_empty() { k.clone() } else { format!("{dir}/{k}") };
                queue.push_back((sub, depth - 1));
            }
        }
    }
    None
}

/// Find the directory *inside a zip* that holds Daz content folders. Real content
/// folders found at any depth win over a shallower Documentation-only level (see
/// `find_content_level`); a meta-only level is the fallback. The production
/// callers (`diff_zip_archive` / `collect_zip_files`) inline this precedence with
/// the nested-package descent between the two passes; this helper states the base
/// rule for the tests.
#[cfg(test)]
fn find_zip_content_level(paths: &[&str]) -> Option<(String, Vec<String>)> {
    zip_dir_level(paths, &CONTENT_FOLDERS).or_else(|| zip_dir_level(paths, &META_FOLDERS))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::unique_temp_dir;

    #[test]
    fn zip_content_level_at_root() {
        let paths = vec!["data/foo.dsf", "Runtime/Textures/x.png", "readme.txt"];
        let (root, mut folders) = find_zip_content_level(&paths).unwrap();
        folders.sort();
        assert_eq!(root, "");
        assert_eq!(folders, vec!["Runtime".to_string(), "data".to_string()]);
    }

    #[test]
    fn zip_content_level_nested() {
        let paths = vec![
            "My Asset/Documentation/read.pdf",
            "My Asset/data/people/g9/morph.dsf",
            "My Asset/People/Genesis 9/x.duf",
        ];
        let (root, mut folders) = find_zip_content_level(&paths).unwrap();
        folders.sort();
        assert_eq!(root, "My Asset");
        // Real content folders (data/People) win over the Documentation meta-folder.
        assert_eq!(folders, vec!["People".to_string(), "data".to_string()]);
    }

    #[test]
    fn zip_content_level_meta_only() {
        let paths = vec!["Pkg/Documentation/read.pdf", "Pkg/notes.txt"];
        let (root, folders) = find_zip_content_level(&paths).unwrap();
        assert_eq!(root, "Pkg");
        assert_eq!(folders, vec!["Documentation".to_string()]);
    }

    #[test]
    fn zip_content_level_none() {
        let paths = vec!["random/file.txt", "other.bin"];
        assert!(find_zip_content_level(&paths).is_none());
    }

    #[test]
    fn zip_content_level_matches_case_insensitively_keeping_the_archive_casing() {
        // A `DATA/`-cased archive is the same library folder on NTFS — it must
        // not report "no Daz content". The ACTUAL casing comes back so entry
        // paths still prefix-match.
        let paths = vec!["Pkg/DATA/foo.dsf", "Pkg/runtime/Textures/x.png"];
        let (root, mut folders) = find_zip_content_level(&paths).unwrap();
        folders.sort();
        assert_eq!(root, "Pkg");
        assert_eq!(folders, vec!["DATA".to_string(), "runtime".to_string()]);
    }

    #[test]
    fn zip_content_level_prefers_the_shallowest_match_over_sibling_order() {
        // "A" sorts before "zz", but its data folder sits a level DEEPER — the
        // old depth-first search returned Pkg/A/deep; breadth-first, the
        // shallowest content level wins regardless of sibling order.
        let paths = vec!["Pkg/A/deep/data/x.dsf", "Pkg/zz/data/y.dsf"];
        let (root, folders) = find_zip_content_level(&paths).unwrap();
        assert_eq!(root, "Pkg/zz");
        assert_eq!(folders, vec!["data".to_string()]);
    }

    #[test]
    fn content_level_prefers_the_shallowest_match_over_sibling_order() {
        // Folder equivalent of the zip case above: an earlier sibling's deeper
        // match must not beat a later sibling's shallower one.
        let base = unique_temp_dir("content_bfs");
        let asset = base.join("Pack");
        fs::create_dir_all(asset.join("A wrapper").join("inner").join("data")).unwrap();
        fs::create_dir_all(asset.join("z direct").join("Runtime")).unwrap();

        let (root, folders) = find_content_level(&asset, 5).unwrap();
        assert_eq!(root, asset.join("z direct"));
        assert_eq!(folders, vec!["Runtime".to_string()]);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn zip_content_level_descends_past_top_level_documentation() {
        // Documentation at the package root, real content nested under a `My Library`
        // wrapper (the common store layout). The real content must win over the
        // shallower readme — otherwise the install copies only the Documentation.
        let paths = vec![
            "68812_HevieState3D/Documentation/read.pdf",
            "68812_HevieState3D/My Library/data/foo.dsf",
            "68812_HevieState3D/My Library/Runtime/Textures/x.png",
        ];
        let (root, mut folders) = find_zip_content_level(&paths).unwrap();
        folders.sort();
        assert_eq!(root, "68812_HevieState3D/My Library");
        assert_eq!(folders, vec!["Runtime".to_string(), "data".to_string()]);
    }

    #[test]
    fn content_level_descends_past_top_level_documentation() {
        // The folder equivalent of the zip case: a product unpacked as
        // `<asset>/{Documentation, My Library/{data,Runtime}}`. The morphs live under
        // the wrapper, so the search must skip the top-level Documentation folder.
        let base = unique_temp_dir("content_descend");
        let asset = base.join("68812_HevieState3D");
        fs::create_dir_all(asset.join("Documentation")).unwrap();
        fs::create_dir_all(asset.join("My Library").join("data")).unwrap();
        fs::create_dir_all(asset.join("My Library").join("Runtime")).unwrap();

        let (root, mut folders) = find_content_level(&asset, 5).unwrap();
        folders.sort();
        assert_eq!(root, asset.join("My Library"));
        assert_eq!(folders, vec!["Runtime".to_string(), "data".to_string()]);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn content_level_documentation_only_is_the_fallback() {
        // A docs-only asset (no data/People/Runtime anywhere) still resolves — to its
        // Documentation folder — so it reports as installed rather than "no content".
        let base = unique_temp_dir("content_docs_only");
        let asset = base.join("ReadmePack");
        fs::create_dir_all(asset.join("Documentation")).unwrap();

        let (root, folders) = find_content_level(&asset, 5).unwrap();
        assert_eq!(root, asset);
        assert_eq!(folders, vec!["Documentation".to_string()]);

        let _ = fs::remove_dir_all(&base);
    }
}
