use std::fs;
use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::archive::{extract_zip_entry, InflateBudget};
use crate::fsutil::join_rel;

// Whole-character export/import archives (`<Name>_<date>.dcsc.zip`): the studio
// packs one character — its folder (definition, Daz scenes, Houdini projects,
// optionally the generated export trees), its `.dcsmeta/characters/<folder>`
// meta files and its avatar images — into a self-contained zip, and restores
// one on import. The TS side (`lib/rom/api/character-zip.ts`) resolves every
// path and decides what to exclude; this module only walks, deflates and
// inflates ("resolve paths in TS, do heavy file work in Rust").
//
// The zip layout is fixed: `manifest.json` at the root (written verbatim from
// `manifest_json` — the TS side owns its schema), the character folder under
// `character/`, the meta folder under `meta/`, avatars under `images/`.

/// The manifest's fixed entry name — what marks a zip as a character export.
pub(crate) const MANIFEST_ENTRY: &str = "manifest.json";

/// A real manifest is well under a kilobyte; anything past this is not ours.
const MANIFEST_MAX_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipRoot {
    /// Zip-path prefix this root's entries land under (`character`, `meta`).
    pub prefix: String,
    /// Absolute folder to pack. A missing folder contributes nothing (a
    /// character that never generated has no meta folder yet).
    pub dir: String,
    /// Root-relative '/'-paths to prune — a file or a whole subtree. Matched
    /// per whole segment, case-insensitively (NTFS).
    #[serde(default)]
    pub exclude_rel: Vec<String>,
    /// Directory NAMES pruned at any depth, case-insensitively (`daz-export`,
    /// and the pre-v29 `dth-exports` which can sit at a legacy location).
    #[serde(default)]
    pub exclude_dir_names: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZipExtraFile {
    /// Full zip entry path (e.g. `images/<avatar file>`).
    pub zip_path: String,
    /// Absolute file to read. A missing file contributes nothing.
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCharacterZipRequest {
    /// Absolute path of the zip to create (overwritten if present — the caller
    /// picks a free name).
    pub zip_path: String,
    /// The manifest text, written verbatim as `manifest.json`.
    pub manifest_json: String,
    pub roots: Vec<ZipRoot>,
    #[serde(default)]
    pub files: Vec<ZipExtraFile>,
}

/// Wire shape mirrored by `exportZipReportSchema` in apps/web's
/// `api/native-types.ts` and pinned by `contracts/export-zip-report.json`.
#[derive(Debug, Default, Serialize)]
#[cfg_attr(test, derive(Deserialize))]
#[serde(rename_all = "camelCase")]
pub struct ExportZipReport {
    /// File entries written (the manifest included).
    pub files: u64,
    /// Uncompressed input bytes packed.
    pub bytes: u64,
    /// Directory links/junctions inside a packed root — never followed (the
    /// crate-wide walker policy), so their targets are NOT in the zip. Callers
    /// surface the count instead of letting the omission pass silently.
    pub skipped_links: u64,
}

/// Deflate + zip64 for every entry: a character's Alembic caches routinely
/// pass the 4 GiB classic-zip limit, and `large_file` is what keeps
/// `start_file` from erroring on them.
fn zip_options() -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default().large_file(true)
}

/// Whether `rel` (root-relative, '/'-separated) is — or sits under — one of the
/// excluded rel paths. Whole-segment prefix compare, case-insensitive.
fn excluded_rel(rel: &str, excludes: &[String]) -> bool {
    let rel_l = rel.to_lowercase();
    excludes.iter().any(|e| {
        let e = e.trim_matches('/').replace('\\', "/").to_lowercase();
        !e.is_empty() && (rel_l == e || rel_l.starts_with(&format!("{e}/")))
    })
}

/// Pack one directory level into the writer (recursive). Entries are packed in
/// name order so the archive layout is deterministic. Directory entries are
/// written for every directory — that's what lets an EMPTY seeded folder
/// (`houdini`, `export`) survive the round trip.
fn pack_dir(
    writer: &mut zip::ZipWriter<fs::File>,
    dir: &Path,
    prefix: &str,
    rel: &str,
    spec: &ZipRoot,
    report: &mut ExportZipReport,
) -> Result<(), String> {
    let mut entries: Vec<fs::DirEntry> = fs::read_dir(dir)
        .map_err(|e| format!("read {}: {e}", dir.display()))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("read {}: {e}", dir.display()))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        if excluded_rel(&child_rel, &spec.exclude_rel) {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|e| format!("stat {}: {e}", entry.path().display()))?;
        if file_type.is_dir() {
            if spec.exclude_dir_names.iter().any(|d| d.eq_ignore_ascii_case(&name)) {
                continue;
            }
            writer
                .add_directory(format!("{prefix}/{child_rel}"), zip_options())
                .map_err(|e| format!("zip dir {child_rel}: {e}"))?;
            pack_dir(writer, &entry.path(), prefix, &child_rel, spec, report)?;
        } else if file_type.is_symlink() && entry.path().is_dir() {
            // A directory link is a LEAF, never followed — same policy as every
            // walker in the crate (a cycle would loop forever; a link can
            // escape the tree). Counted, so the caller can say so.
            report.skipped_links += 1;
        } else {
            pack_file(writer, &entry.path(), &format!("{prefix}/{child_rel}"), report)?;
        }
    }
    Ok(())
}

fn pack_file(
    writer: &mut zip::ZipWriter<fs::File>,
    path: &Path,
    zip_path: &str,
    report: &mut ExportZipReport,
) -> Result<(), String> {
    writer
        .start_file(zip_path, zip_options())
        .map_err(|e| format!("zip entry {zip_path}: {e}"))?;
    let mut file = fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let bytes = std::io::copy(&mut file, writer).map_err(|e| format!("pack {zip_path}: {e}"))?;
    report.files += 1;
    report.bytes += bytes;
    Ok(())
}

/// Pack a character into a `.dcsc.zip`. A failure removes the half-written zip
/// rather than leaving a torn archive where a good export was expected.
///
/// `(async)`: export trees may be gigabytes and may sit on a NAS — deflating
/// them on the main thread would freeze every window.
#[tauri::command(async)]
pub fn export_character_zip(request: ExportCharacterZipRequest) -> Result<ExportZipReport, String> {
    let zip_path = Path::new(&request.zip_path);
    if let Some(parent) = zip_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
    }
    let file =
        fs::File::create(zip_path).map_err(|e| format!("create {}: {e}", zip_path.display()))?;
    let mut writer = zip::ZipWriter::new(file);
    let mut report = ExportZipReport::default();
    let packed = (|| -> Result<(), String> {
        writer
            .start_file(MANIFEST_ENTRY, zip_options())
            .map_err(|e| format!("zip entry {MANIFEST_ENTRY}: {e}"))?;
        writer
            .write_all(request.manifest_json.as_bytes())
            .map_err(|e| format!("write {MANIFEST_ENTRY}: {e}"))?;
        report.files += 1;
        report.bytes += request.manifest_json.len() as u64;
        for root in &request.roots {
            let dir = Path::new(&root.dir);
            if !dir.is_dir() {
                continue;
            }
            pack_dir(&mut writer, dir, &root.prefix, "", root, &mut report)?;
        }
        for extra in &request.files {
            let path = Path::new(&extra.path);
            if !path.is_file() {
                continue;
            }
            pack_file(&mut writer, path, &extra.zip_path, &mut report)?;
        }
        Ok(())
    })();
    match packed {
        Ok(()) => {
            writer.finish().map_err(|e| format!("finish {}: {e}", zip_path.display()))?;
            Ok(report)
        }
        Err(e) => {
            drop(writer);
            let _ = fs::remove_file(zip_path);
            Err(e)
        }
    }
}

/// The `manifest.json` text of a character export zip — how the TS side decides
/// a picked/dropped zip is one of ours (and which character it carries) BEFORE
/// extracting anything. Errors name the reason (not a zip, no manifest).
#[tauri::command(async)]
pub fn read_character_zip_manifest(zip_path: String) -> Result<String, String> {
    let file = fs::File::open(&zip_path).map_err(|e| format!("open {zip_path}: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("{zip_path} is not a readable zip: {e}"))?;
    let entry = archive.by_name(MANIFEST_ENTRY).map_err(|_| {
        "This zip is not a DTH Character Studio character export (no manifest.json at its root)."
            .to_string()
    })?;
    if entry.size() > MANIFEST_MAX_BYTES {
        return Err("The zip's manifest.json is implausibly large — refusing to read it.".into());
    }
    let mut text = String::new();
    entry
        .take(MANIFEST_MAX_BYTES)
        .read_to_string(&mut text)
        .map_err(|e| format!("read {MANIFEST_ENTRY}: {e}"))?;
    Ok(text)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractCharacterZipRequest {
    pub zip_path: String,
    /// Absolute STAGING folder to inflate into (created if missing). The TS
    /// side validates the staged tree before touching any live character, so a
    /// refusal here can never leave a half-overwritten character behind.
    pub dest_dir: String,
}

/// Inflate a character export zip into a staging folder, under the same
/// decompression-bomb bounds as the asset installers (users share these zips).
/// An entry whose name escapes the archive refuses the WHOLE import — the
/// studio's own exports never produce one, so its presence means the zip is
/// hostile or corrupt. Returns the number of files extracted.
#[tauri::command(async)]
pub fn extract_character_zip(request: ExtractCharacterZipRequest) -> Result<u64, String> {
    let file = fs::File::open(&request.zip_path)
        .map_err(|e| format!("open {}: {e}", request.zip_path))?;
    let compressed = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("{} is not a readable zip: {e}", request.zip_path))?;
    let mut budget = InflateBudget::new(request.zip_path.clone(), compressed);
    budget.check_entry_count(archive.len()).map_err(|e| e.to_string())?;
    let dest = Path::new(&request.dest_dir);
    fs::create_dir_all(dest).map_err(|e| format!("create {}: {e}", dest.display()))?;
    let mut files = 0u64;
    for i in 0..archive.len() {
        let (rel, is_dir) = {
            let entry = archive
                .by_index(i)
                .map_err(|e| format!("read zip entry {i}: {e}"))?;
            match entry.enclosed_name() {
                Some(name) => (name.to_string_lossy().replace('\\', "/"), entry.is_dir()),
                None => {
                    return Err(format!(
                        "refusing to import: the zip contains an unsafe entry path ({})",
                        entry.name()
                    ));
                }
            }
        };
        let target = join_rel(dest, &rel);
        if is_dir {
            fs::create_dir_all(&target)
                .map_err(|e| format!("create {}: {e}", target.display()))?;
            continue;
        }
        extract_zip_entry(&mut archive, i, &target, &mut budget)
            .map_err(|e| format!("extract {rel}: {e}"))?;
        files += 1;
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{unique_temp_dir, write_zip};

    fn write_file(path: &Path, content: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn zip_entry_names(path: &Path) -> Vec<String> {
        let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
        let mut names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        names.sort();
        names
    }

    /// A character-shaped tree with generated export trees and a meta folder.
    fn seed_character(base: &Path) -> (std::path::PathBuf, std::path::PathBuf) {
        let char_dir = base.join("Kira");
        write_file(&char_dir.join("Kira.json"), b"{\"id\":\"char-kira\"}");
        write_file(&char_dir.join("Kira.notes.md"), b"notes");
        write_file(&char_dir.join("daz3d/primary/Kira.duf"), b"scene");
        write_file(&char_dir.join("houdini/Kira.hiplc"), b"hip");
        write_file(&char_dir.join("houdini/daz-export/primary/Kira.abc"), b"alembic");
        write_file(&char_dir.join("daz3d/dth-exports/old/Kira.abc"), b"legacy");
        write_file(&char_dir.join("export/Kira_final.fbx"), b"fbx");
        write_file(&char_dir.join(".dth_houdini_job.json"), b"transient");
        // An EMPTY seeded folder must survive the round trip.
        fs::create_dir_all(char_dir.join("empty-seed")).unwrap();
        let meta_dir = base.join(".dcsmeta/characters/Kira");
        write_file(&meta_dir.join(".dth_execute_stamps.json"), b"{}");
        (char_dir, meta_dir)
    }

    fn export_request(
        base: &Path,
        char_dir: &Path,
        meta_dir: &Path,
        include_exports: bool,
    ) -> ExportCharacterZipRequest {
        let mut exclude_dir_names = Vec::new();
        let mut exclude_rel = vec![".dth_houdini_job.json".to_string()];
        if !include_exports {
            exclude_dir_names.extend(["daz-export".to_string(), "dth-exports".to_string()]);
            exclude_rel.push("export".to_string());
        }
        ExportCharacterZipRequest {
            zip_path: base.join("Kira.dcsc.zip").to_string_lossy().into_owned(),
            manifest_json: "{\"format\":\"dcs-character\"}".to_string(),
            roots: vec![
                ZipRoot {
                    prefix: "character".into(),
                    dir: char_dir.to_string_lossy().into_owned(),
                    exclude_rel,
                    exclude_dir_names,
                },
                ZipRoot {
                    prefix: "meta".into(),
                    dir: meta_dir.to_string_lossy().into_owned(),
                    exclude_rel: vec![],
                    exclude_dir_names: vec![],
                },
            ],
            files: vec![ZipExtraFile {
                zip_path: "images/char-kira--sc-1.png".into(),
                path: base.join("char-kira--sc-1.png").to_string_lossy().into_owned(),
            }],
        }
    }

    #[test]
    fn export_packs_everything_and_honors_exclusions() {
        let base = unique_temp_dir("charzip_export");
        let (char_dir, meta_dir) = seed_character(&base);
        write_file(&base.join("char-kira--sc-1.png"), b"png");

        // Slim export: both export trees and the transient job file excluded.
        let report =
            export_character_zip(export_request(&base, &char_dir, &meta_dir, false)).unwrap();
        let names = zip_entry_names(&base.join("Kira.dcsc.zip"));
        assert!(names.contains(&"manifest.json".to_string()));
        assert!(names.contains(&"character/Kira.json".to_string()));
        assert!(names.contains(&"character/daz3d/primary/Kira.duf".to_string()));
        assert!(names.contains(&"character/houdini/Kira.hiplc".to_string()));
        assert!(names.contains(&"meta/.dth_execute_stamps.json".to_string()));
        assert!(names.contains(&"images/char-kira--sc-1.png".to_string()));
        // Directory entries preserve the empty seeded folder.
        assert!(names.iter().any(|n| n.starts_with("character/empty-seed")));
        // The exclusions: no export trees, no transient job file.
        assert!(!names.iter().any(|n| n.contains("daz-export")));
        assert!(!names.iter().any(|n| n.contains("dth-exports")));
        assert!(!names.iter().any(|n| n.starts_with("character/export/")));
        assert!(!names.iter().any(|n| n.contains(".dth_houdini_job.json")));
        // 7 file entries: manifest, json, notes, duf, hiplc, meta stamps, avatar.
        assert_eq!(report.files, 7);
        assert!(report.bytes > 0);
        assert_eq!(report.skipped_links, 0);

        // Full export carries both export trees (and still not the job file).
        export_character_zip(export_request(&base, &char_dir, &meta_dir, true)).unwrap();
        let names = zip_entry_names(&base.join("Kira.dcsc.zip"));
        assert!(names.contains(&"character/houdini/daz-export/primary/Kira.abc".to_string()));
        assert!(names.contains(&"character/daz3d/dth-exports/old/Kira.abc".to_string()));
        assert!(names.contains(&"character/export/Kira_final.fbx".to_string()));
        assert!(!names.iter().any(|n| n.contains(".dth_houdini_job.json")));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn export_then_extract_round_trips_the_tree() {
        let base = unique_temp_dir("charzip_roundtrip");
        let (char_dir, meta_dir) = seed_character(&base);
        write_file(&base.join("char-kira--sc-1.png"), b"png");
        let request = export_request(&base, &char_dir, &meta_dir, true);
        let zip_path = request.zip_path.clone();
        export_character_zip(request).unwrap();

        let staged = base.join("staging");
        let files = extract_character_zip(ExtractCharacterZipRequest {
            zip_path: zip_path.clone(),
            dest_dir: staged.to_string_lossy().into_owned(),
        })
        .unwrap();
        assert!(files > 0);
        assert_eq!(fs::read(staged.join("character/Kira.json")).unwrap(), b"{\"id\":\"char-kira\"}");
        assert_eq!(
            fs::read(staged.join("character/houdini/daz-export/primary/Kira.abc")).unwrap(),
            b"alembic"
        );
        assert_eq!(fs::read(staged.join("meta/.dth_execute_stamps.json")).unwrap(), b"{}");
        assert_eq!(fs::read(staged.join("images/char-kira--sc-1.png")).unwrap(), b"png");
        assert!(staged.join("character/empty-seed").is_dir(), "empty folder survives");

        // The manifest reads back verbatim.
        let manifest = read_character_zip_manifest(zip_path).unwrap();
        assert_eq!(manifest, "{\"format\":\"dcs-character\"}");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn manifest_read_refuses_a_foreign_zip() {
        let base = unique_temp_dir("charzip_foreign");
        fs::create_dir_all(&base).unwrap();
        let path = base.join("foreign.zip");
        write_zip(&path, &[("data/thing.dsf", b"x".as_slice())]);
        let err = read_character_zip_manifest(path.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("not a DTH Character Studio character export"), "{err}");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn extract_refuses_an_unsafe_entry_path() {
        let base = unique_temp_dir("charzip_slip");
        fs::create_dir_all(&base).unwrap();
        let path = base.join("evil.zip");
        write_zip(
            &path,
            &[("manifest.json", b"{}".as_slice()), ("../evil.json", b"evil".as_slice())],
        );
        let err = extract_character_zip(ExtractCharacterZipRequest {
            zip_path: path.to_string_lossy().into_owned(),
            dest_dir: base.join("staged").to_string_lossy().into_owned(),
        })
        .unwrap_err();
        assert!(err.contains("unsafe entry path"), "{err}");
        let _ = fs::remove_dir_all(&base);
    }
}
