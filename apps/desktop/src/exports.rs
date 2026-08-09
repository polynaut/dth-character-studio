use serde::Deserialize;
use std::path::Path;

use crate::fsutil::move_tree;

// Moving a character's already-exported files into the fixed export root.
// Written for schema v29 (before it, the export directory was user-chosen, so an
// existing character's .abc/.dth/.csv sat wherever it pointed) and used again
// for the later move of the root itself. The studio re-derives the path on the
// character's next save; this command carries the FILES across so a relocation
// doesn't strand gigabytes at the old location.
//
// The studio decides WHICH folders move (it knows its own layout from the
// per-character export-folders record) and passes explicit absolute pairs —
// paths resolve in TS, heavy file work happens here.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportMove {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveExportsRequest {
    pub moves: Vec<ExportMove>,
}

/// Move each requested export folder. Returns one human-readable line per
/// FAILURE — an empty list means every move succeeded. Deliberately not a
/// structured report: the caller needs "did anything go wrong, and what do I
/// tell the user", and a `Vec<String>` needs no wire fixture.
///
/// Per-folder best effort: one folder failing must not abandon the rest, and a
/// failure never loses data ({@link move_tree} keeps a complete copy before
/// deleting any source). Sources that no longer exist are silently skipped —
/// the migration is idempotent, so a re-run finds most of them already moved.
/// A destination that already exists is REFUSED rather than merged: two export
/// trees claiming one folder is the user's call, not ours.
#[tauri::command]
pub fn move_exports(request: MoveExportsRequest) -> Vec<String> {
    let mut failures = Vec::new();
    for item in &request.moves {
        let from = Path::new(&item.from);
        let to = Path::new(&item.to);
        if !from.exists() {
            continue;
        }
        if to.exists() {
            failures.push(format!(
                "{} already exists — left {} where it is",
                item.to, item.from
            ));
            continue;
        }
        if let Err(reason) = move_tree(from, to) {
            failures.push(format!("{}: {reason}", item.from));
        }
    }
    failures
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn req(pairs: &[(&Path, &Path)]) -> MoveExportsRequest {
        MoveExportsRequest {
            moves: pairs
                .iter()
                .map(|(f, t)| ExportMove {
                    from: f.to_string_lossy().into_owned(),
                    to: t.to_string_lossy().into_owned(),
                })
                .collect(),
        }
    }

    #[test]
    fn moves_each_folder_skips_missing_and_refuses_to_clobber() {
        let base = std::env::temp_dir().join("dth_move_exports_test");
        let _ = fs::remove_dir_all(&base);
        let old = base.join("houdini/Proj/dth-export");
        let new = base.join("houdini/daz-export");
        fs::create_dir_all(old.join("primary")).unwrap();
        fs::write(old.join("primary/Kira.dth"), b"payload").unwrap();
        fs::create_dir_all(old.join("summertide")).unwrap();
        // A destination already holding this scene's folder must not be merged.
        fs::create_dir_all(new.join("summertide")).unwrap();

        let failures = move_exports(req(&[
            (&old.join("primary"), &new.join("primary")),
            (&old.join("summertide"), &new.join("summertide")),
            // Never exported — silently skipped, not a failure.
            (&old.join("gone"), &new.join("gone")),
        ]));

        assert_eq!(failures.len(), 1);
        assert!(failures[0].contains("already exists"));
        assert_eq!(
            fs::read_to_string(new.join("primary/Kira.dth")).unwrap(),
            "payload"
        );
        assert!(!old.join("primary").exists());
        // The refused one stayed put — nothing was destroyed.
        assert!(old.join("summertide").exists());

        // Idempotent: a re-run finds the sources gone and reports nothing.
        let again = move_exports(req(&[(&old.join("primary"), &new.join("primary"))]));
        assert!(again.is_empty());

        let _ = fs::remove_dir_all(&base);
    }
}
