use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

/// Whether a read_dir entry is a real directory WITHOUT following symlinks/
/// junctions — `Path::is_dir()` follows them, which lets a recursive walk escape
/// its tree (delete outside app-data) or loop forever on a junction cycle. Use
/// this in every recursive walker so a linked dir is treated as a leaf and skipped.
pub(crate) fn entry_is_real_dir(entry: &fs::DirEntry) -> bool {
    entry.file_type().map(|t| t.is_dir()).unwrap_or(false)
}

/// Guard a user/settings-supplied path before a RECURSIVE delete: refuse a
/// filesystem/drive root or a path so shallow (fewer than two real name segments)
/// that deleting it would wipe a drive or a top-level profile folder. Returns
/// Some(reason) to refuse, None to allow. Defense-in-depth even against a poisoned
/// settings.json — the UI confirm is not the only safeguard.
pub(crate) fn unsafe_recursive_target(path: &Path) -> Option<String> {
    if path.parent().is_none() {
        return Some(format!("refusing to delete a filesystem root ({})", path.display()));
    }
    let named = path
        .components()
        .filter(|c| matches!(c, std::path::Component::Normal(_)))
        .count();
    if named < 2 {
        return Some(format!("refusing to delete a top-level path ({})", path.display()));
    }
    None
}

/// Whether any path segment contains "daz" (case-insensitive) — a Daz-owned
/// folder. Gates the uninstall's recursive deletes so a stray/poisoned path
/// (e.g. the user's Documents) can never be wiped by the cleanup.
pub(crate) fn looks_like_daz_folder(path: &Path) -> bool {
    path.components().any(|c| match c {
        std::path::Component::Normal(s) => s.to_string_lossy().to_lowercase().contains("daz"),
        _ => false,
    })
}

/// Number of files (recursively) under `dir`; 0 when it can't be read. Does not
/// follow directory symlinks/junctions (see `entry_is_real_dir`).
pub(crate) fn count_files(dir: &Path) -> u64 {
    let mut n = 0;
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry_is_real_dir(&entry) {
                n += count_files(&entry.path());
            } else {
                n += 1;
            }
        }
    }
    n
}

/// Recursively copy `src` into `dst` (created if missing; overwrites), returning
/// the number of files copied.
pub(crate) fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<u64> {
    fs::create_dir_all(dst)?;
    let mut count = 0;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry_is_real_dir(&entry) {
            count += copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
            count += 1;
        }
    }
    Ok(count)
}

/// Recursively copy `src` into `dst`, adding only files missing at the
/// destination (never overwrites — preserves the user's edits). Returns files added.
pub(crate) fn copy_dir_add_only(src: &Path, dst: &Path) -> std::io::Result<u64> {
    fs::create_dir_all(dst)?;
    let mut count = 0;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry_is_real_dir(&entry) {
            count += copy_dir_add_only(&from, &to)?;
        } else if !to.exists() {
            fs::copy(&from, &to)?;
            count += 1;
        }
    }
    Ok(count)
}

/// The display name of a path's final component.
pub(crate) fn folder_name(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| p.display().to_string())
}

/// Striped locks keyed by destination path: assets install in parallel, and two
/// that map to the SAME library file (e.g. a folder and its `.zip`) must not write
/// it at once. Same path → same stripe → serialized; different paths almost always
/// take different stripes → still parallel. 64 stripes comfortably covers the pool.
const DEST_LOCK_STRIPES: usize = 64;
pub(crate) fn lock_dest(path: &Path) -> MutexGuard<'static, ()> {
    static LOCKS: OnceLock<Vec<Mutex<()>>> = OnceLock::new();
    let locks = LOCKS.get_or_init(|| (0..DEST_LOCK_STRIPES).map(|_| Mutex::new(())).collect());
    let mut h = DefaultHasher::new();
    path.hash(&mut h);
    let idx = (h.finish() as usize) % DEST_LOCK_STRIPES;
    // Recover from a poisoned lock — the guarded data is `()`, so there's nothing
    // to corrupt; a peer thread panicking shouldn't wedge the rest of the install.
    locks[idx].lock().unwrap_or_else(|e| e.into_inner())
}

/// Join a `/`-separated relative path onto `base`, component by component (so the
/// separator is normalized to the OS one rather than relying on `/` passthrough).
pub(crate) fn join_rel(base: &Path, rel: &str) -> PathBuf {
    let mut p = base.to_path_buf();
    for c in rel.split('/').filter(|s| !s.is_empty()) {
        p.push(c);
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_rel_uses_components() {
        let joined = join_rel(Path::new("base"), "data/foo/bar.dsf");
        assert_eq!(joined, Path::new("base").join("data").join("foo").join("bar.dsf"));
    }

    #[test]
    fn recursive_delete_guards_refuse_roots_and_non_daz_paths() {
        // Roots / too-shallow paths are refused for any recursive delete.
        assert!(unsafe_recursive_target(Path::new("C:\\")).is_some());
        assert!(unsafe_recursive_target(Path::new("C:\\Users")).is_some());
        assert!(unsafe_recursive_target(Path::new("/")).is_some());
        // Two+ real segments is allowed by the shallow-path rail.
        assert!(unsafe_recursive_target(Path::new("C:\\Users\\Bob\\Documents")).is_none());
        // The uninstall additionally requires a Daz-owned segment.
        assert!(looks_like_daz_folder(Path::new("C:\\Users\\Bob\\Documents\\DAZ 3D")));
        assert!(looks_like_daz_folder(Path::new("C:\\Program Files\\DAZ 3D\\DAZStudio6")));
        assert!(!looks_like_daz_folder(Path::new("C:\\Users\\Bob\\Documents")));
    }
}
