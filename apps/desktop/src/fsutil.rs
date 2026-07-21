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

/// Case-normalized key for a destination-relative path. NTFS resolves paths
/// case-insensitively, so every rel-path map key / lookup in the compare
/// pipelines (install diff, winner resolution, dedup grouping) must fold case —
/// otherwise a case-variant installed file is re-copied forever and case-variant
/// shared files never meet in the same bucket. Unicode-aware (`to_lowercase`,
/// not ascii-only — Daz assets carry non-ASCII names). Anything user-visible or
/// written to disk keeps the ORIGINAL casing; only the KEYS fold.
pub(crate) fn rel_key(rel: &str) -> String {
    rel.to_lowercase()
}

/// Visitor for `walk_dir` — the ONE shared recursive walker, so every walk in
/// the crate encodes the same links policy: a directory symlink/junction is a
/// LEAF, never followed (following one can loop forever on a cycle or escape
/// the tree). Callbacks return `io::Result` so a strict visitor (install
/// copies) can abort the walk with `Err`; lenient visitors (scans, counts)
/// record the problem and return `Ok`.
pub(crate) trait DirVisitor {
    /// Entering a real subdirectory (never called for the walk root).
    fn enter_dir(&mut self, _entry: &fs::DirEntry, _rel: &Path) -> std::io::Result<()> {
        Ok(())
    }
    /// A non-directory entry (a regular file, or a file symlink).
    fn file(&mut self, entry: &fs::DirEntry, rel: &Path) -> std::io::Result<()>;
    /// A directory symlink/junction — reported, never descended into.
    fn dir_link(&mut self, _entry: &fs::DirEntry, _rel: &Path) -> std::io::Result<()> {
        Ok(())
    }
    /// A directory listing / entry that couldn't be read. Strict visitors return
    /// the error; lenient ones count it (an incomplete inventory must be VISIBLE
    /// — dedup refuses to quarantine groups scanned with read errors).
    fn unreadable(&mut self, path: &Path, e: std::io::Error) -> std::io::Result<()>;
}

/// Recursively walk `root` (which must be a directory), reporting every entry to
/// `visitor` with its path relative to `root`. Directory links are leaves (see
/// `DirVisitor`); the extra `is_dir` stat runs only for symlink entries.
pub(crate) fn walk_dir<V: DirVisitor>(root: &Path, visitor: &mut V) -> std::io::Result<()> {
    walk_below(root, Path::new(""), visitor)
}

fn walk_below<V: DirVisitor>(dir: &Path, rel: &Path, v: &mut V) -> std::io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) => return v.unreadable(dir, e),
    };
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                v.unreadable(dir, e)?;
                continue;
            }
        };
        let child_rel = rel.join(entry.file_name());
        match entry.file_type() {
            Ok(t) if t.is_dir() => {
                v.enter_dir(&entry, &child_rel)?;
                walk_below(&entry.path(), &child_rel, v)?;
            }
            // A symlink/junction to a directory (std reports junctions as
            // symlinks too): a leaf, never followed.
            Ok(t) if t.is_symlink() && entry.path().is_dir() => v.dir_link(&entry, &child_rel)?,
            Ok(_) => v.file(&entry, &child_rel)?,
            Err(e) => v.unreadable(&entry.path(), e)?,
        }
    }
    Ok(())
}

/// Visitor collecting files another process holds with a deny-write/rename lock
/// — the ones a folder move would fail on. See `probe_locked_files`.
struct LockedFiles {
    locked: Vec<String>,
}

impl DirVisitor for LockedFiles {
    fn file(&mut self, entry: &fs::DirEntry, _rel: &Path) -> std::io::Result<()> {
        let path = entry.path();
        // Probe by opening for write: a Windows sharing violation (os error 32)
        // means another process holds it without share-delete — it can't be
        // renamed/moved. Opening read+write never truncates an existing file.
        // Everything else (opened fine, permission denied, gone mid-walk) counts
        // as movable; Unix has no mandatory locks, so its files read as unlocked
        // and moves there generally succeed regardless.
        let locked = match fs::OpenOptions::new().read(true).write(true).open(&path) {
            Ok(_) => false,
            Err(e) => e.raw_os_error() == Some(32),
        };
        if locked {
            self.locked.push(path.to_string_lossy().replace('\\', "/"));
        }
        Ok(())
    }

    fn unreadable(&mut self, _path: &Path, _e: std::io::Error) -> std::io::Result<()> {
        // A folder we can't list isn't a per-file lock — let the move itself
        // surface that error.
        Ok(())
    }
}

/// The files under `dir` currently locked by another process (open in Daz Studio
/// / Houdini), which a folder move can't relocate — surfaced to the user so they
/// can close those apps and retry. `/`-normalised absolute paths, sorted. Empty
/// when `dir` is missing or nothing is locked. Best-effort on Unix (no mandatory
/// locks). Async so the per-file probe walk runs off the main thread.
#[tauri::command(async)]
pub fn probe_locked_files(dir: String) -> Vec<String> {
    let root = Path::new(&dir);
    if !root.is_dir() {
        return Vec::new();
    }
    let mut v = LockedFiles { locked: Vec::new() };
    let _ = walk_dir(root, &mut v);
    v.locked.sort();
    v.locked
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

/// Whether one path segment names a Daz-owned folder: "DAZ" as a whole word
/// ("DAZ 3D", "My DAZ 3D Library", "DAZ_3D") or a known Daz product-folder
/// prefix ("DAZStudio4", "Daz3D", "DazToHue"). A segment that merely CONTAINS
/// the letters (a profile like `C:\Users\dazzler`) must NOT match — this gates
/// recursive deletes.
fn segment_is_daz(segment: &str) -> bool {
    let lower = segment.to_lowercase();
    if ["dazstudio", "daz3d", "daztohue"].iter().any(|p| lower.starts_with(p)) {
        return true;
    }
    lower.split(|c: char| !c.is_alphanumeric()).any(|word| word == "daz")
}

/// Whether any path segment names a Daz-owned folder (see `segment_is_daz`).
/// Gates the uninstall's recursive deletes so a stray/poisoned path
/// (e.g. the user's Documents — or `C:\Users\dazzler`) can never be wiped by
/// the cleanup.
pub(crate) fn looks_like_daz_folder(path: &Path) -> bool {
    path.components().any(|c| match c {
        std::path::Component::Normal(s) => segment_is_daz(&s.to_string_lossy()),
        _ => false,
    })
}

/// Whether `inner` equals — or lives under — `outer`, compared per component and
/// case-insensitively (NTFS). Callers should pass canonical paths (`rail_target`)
/// so junctions/`..` spellings can't dodge the check.
pub(crate) fn path_contains(outer: &Path, inner: &Path) -> bool {
    let fold = |p: &Path| -> Vec<String> {
        p.components().map(|c| c.as_os_str().to_string_lossy().to_lowercase()).collect()
    };
    let (o, i) = (fold(outer), fold(inner));
    i.len() >= o.len() && o.iter().zip(&i).all(|(a, b)| a == b)
}

/// The path the recursive-delete rails should judge: the CANONICAL form when the
/// target exists — so a `..`-laden spelling or a junction/symlink can't dress a
/// dangerous target (a drive root, a profile folder) up as a safe-looking one —
/// and the raw path when it doesn't (missing targets keep their existing
/// "not found" handling). Segment counting still works on the canonical form:
/// the Windows `\\?\` verbatim prefix is a `Prefix`/`RootDir` component, never a
/// `Normal` one, so it adds no phantom segments.
pub(crate) fn rail_target(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Number of files (recursively) under `dir`; 0 when it can't be read. Does not
/// follow directory symlinks/junctions (a link counts as one entry, like the
/// delete/dry-run paths that consume this count treat it).
pub(crate) fn count_files(dir: &Path) -> u64 {
    struct Count(u64);
    impl DirVisitor for Count {
        fn file(&mut self, _entry: &fs::DirEntry, _rel: &Path) -> std::io::Result<()> {
            self.0 += 1;
            Ok(())
        }
        fn dir_link(&mut self, _entry: &fs::DirEntry, _rel: &Path) -> std::io::Result<()> {
            self.0 += 1;
            Ok(())
        }
        fn unreadable(&mut self, _path: &Path, _e: std::io::Error) -> std::io::Result<()> {
            Ok(()) // lenient: an unreadable subfolder contributes nothing
        }
    }
    let mut v = Count(0);
    let _ = walk_dir(dir, &mut v);
    v.0
}

/// What a recursive copy did: files written, plus directory symlinks/junctions
/// it deliberately did NOT follow (skipping them silently hid the fact the copy
/// was partial — callers surface the count in their report channel).
pub(crate) struct CopyStats {
    pub(crate) files: u64,
    pub(crate) skipped_links: u64,
}

struct CopyVisitor<'a> {
    dst_root: &'a Path,
    /// false = add-only (never overwrite an existing destination file).
    overwrite: bool,
    stats: CopyStats,
}
impl DirVisitor for CopyVisitor<'_> {
    fn enter_dir(&mut self, _entry: &fs::DirEntry, rel: &Path) -> std::io::Result<()> {
        fs::create_dir_all(self.dst_root.join(rel))
    }
    fn file(&mut self, entry: &fs::DirEntry, rel: &Path) -> std::io::Result<()> {
        let to = self.dst_root.join(rel);
        if !self.overwrite && to.exists() {
            return Ok(());
        }
        fs::copy(entry.path(), &to)?;
        self.stats.files += 1;
        Ok(())
    }
    fn dir_link(&mut self, _entry: &fs::DirEntry, _rel: &Path) -> std::io::Result<()> {
        // Never follow a dir link while COPYING: a cycle would loop forever
        // (filling the destination disk) and a link can escape the source tree.
        // Same policy as every walker here — but counted, so it's reportable.
        self.stats.skipped_links += 1;
        Ok(())
    }
    fn unreadable(&mut self, _path: &Path, e: std::io::Error) -> std::io::Result<()> {
        Err(e) // strict: a copy must not silently omit content
    }
}

fn copy_dir_impl(src: &Path, dst: &Path, overwrite: bool) -> std::io::Result<CopyStats> {
    fs::create_dir_all(dst)?;
    let mut v = CopyVisitor { dst_root: dst, overwrite, stats: CopyStats { files: 0, skipped_links: 0 } };
    walk_dir(src, &mut v)?;
    Ok(v.stats)
}

/// Recursively copy `src` into `dst` (created if missing; overwrites).
/// Directory symlinks/junctions are skipped (counted in the stats), exactly like
/// every other walker here — they are not the tree's own content.
pub(crate) fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<CopyStats> {
    copy_dir_impl(src, dst, true)
}

/// Recursively copy `src` into `dst`, adding only files missing at the
/// destination (never overwrites — preserves the user's edits).
pub(crate) fn copy_dir_add_only(src: &Path, dst: &Path) -> std::io::Result<CopyStats> {
    copy_dir_impl(src, dst, false)
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

/// The stripe a destination path hashes to — folded like `rel_key` (lowercased,
/// separators normalized) because NTFS resolves case-variant spellings of one
/// destination to the SAME file: hashing the raw `Path` put the exact writers
/// the lock must serialize on different stripes.
fn lock_stripe(path: &Path) -> usize {
    let mut h = DefaultHasher::new();
    rel_key(&path.to_string_lossy().replace('\\', "/")).hash(&mut h);
    (h.finish() as usize) % DEST_LOCK_STRIPES
}

pub(crate) fn lock_dest(path: &Path) -> MutexGuard<'static, ()> {
    static LOCKS: OnceLock<Vec<Mutex<()>>> = OnceLock::new();
    let locks = LOCKS.get_or_init(|| (0..DEST_LOCK_STRIPES).map(|_| Mutex::new(())).collect());
    // Recover from a poisoned lock — the guarded data is `()`, so there's nothing
    // to corrupt; a peer thread panicking shouldn't wedge the rest of the install.
    locks[lock_stripe(path)].lock().unwrap_or_else(|e| e.into_inner())
}

/// Join a `/`-separated relative path onto `base`, component by component (so the
/// separator is normalized to the OS one rather than relying on `/` passthrough).
/// `.` and `..` components are DROPPED — a zip-slip rail that holds on every
/// platform: on a Unix build a `..\..\x` zip entry passes `enclosed_name` (one
/// `Normal` component) and only becomes `../../x` after the backslash→slash
/// rewrite, so the escape must be blocked here rather than relying on that order.
pub(crate) fn join_rel(base: &Path, rel: &str) -> PathBuf {
    let mut p = base.to_path_buf();
    for c in rel.split('/').filter(|s| !s.is_empty() && *s != "." && *s != "..") {
        p.push(c);
    }
    p
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::unique_temp_dir;

    #[test]
    fn join_rel_uses_components() {
        let joined = join_rel(Path::new("base"), "data/foo/bar.dsf");
        assert_eq!(joined, Path::new("base").join("data").join("foo").join("bar.dsf"));
    }

    #[test]
    fn join_rel_drops_traversal_components() {
        // A `..`-laden entry (e.g. a backslash-normalised zip path on a Unix build)
        // must not escape `base` — the `.`/`..` components are dropped.
        let joined = join_rel(Path::new("base"), "../../evil.dsf");
        assert_eq!(joined, Path::new("base").join("evil.dsf"));
        assert_eq!(join_rel(Path::new("base"), "a/./b/../c"), Path::new("base").join("a").join("b").join("c"));
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
        // Every folder default_daz_uninstall_folders can emit still passes.
        assert!(looks_like_daz_folder(Path::new("C:\\Users\\Bob\\Documents\\My DAZ 3D Library")));
        assert!(looks_like_daz_folder(Path::new("C:\\Program Files\\DAZ 3D\\DAZStudio4")));
        assert!(looks_like_daz_folder(Path::new(
            "C:\\Users\\Bob\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\DAZ 3D"
        )));
        // "daz" as a mere SUBSTRING must not open the recursive-delete gate: a
        // user profile like `dazzler` used to pass the old contains("daz") rail.
        assert!(!looks_like_daz_folder(Path::new("C:\\Users\\dazzler\\Documents\\stuff")));
        assert!(!looks_like_daz_folder(Path::new("D:\\media\\bedazzled\\photos")));
        // Word-boundary + known product prefixes still match.
        assert!(looks_like_daz_folder(Path::new("D:\\content\\DAZ_3D\\morphs")));
        assert!(looks_like_daz_folder(Path::new("D:\\apps\\Daz3D")));
    }

    #[test]
    fn path_contains_is_component_wise_and_case_insensitive() {
        assert!(path_contains(Path::new("C:\\Assets"), Path::new("C:\\assets\\G9\\thing")));
        assert!(path_contains(Path::new("C:\\Assets"), Path::new("C:\\ASSETS")));
        // A sibling with the same PREFIX string is not contained.
        assert!(!path_contains(Path::new("C:\\Assets"), Path::new("C:\\Assets2\\x")));
        assert!(!path_contains(Path::new("C:\\Assets\\G9"), Path::new("C:\\Assets")));
    }

    #[test]
    fn lock_dest_stripes_fold_case_and_separators() {
        // Case-variant spellings of one NTFS destination are the SAME file — they
        // must serialize on the same stripe (the raw-Path hash split them).
        assert_eq!(
            lock_stripe(Path::new("C:\\Lib\\data\\Morph.dsf")),
            lock_stripe(Path::new("c:/lib/DATA/morph.DSF")),
        );
    }

    #[test]
    fn rel_key_folds_case_unicode_aware() {
        assert_eq!(rel_key("Runtime/Textures/X.png"), "runtime/textures/x.png");
        // Unicode, not ascii-only — Daz assets carry non-ASCII names.
        assert_eq!(rel_key("data/Émilie/Ü.dsf"), "data/émilie/ü.dsf");
    }

    #[test]
    fn copy_dir_copies_recursively_and_reports_stats() {
        let base = unique_temp_dir("copy_stats");
        let src = base.join("src");
        fs::create_dir_all(src.join("sub")).unwrap();
        fs::write(src.join("a.txt"), b"a").unwrap();
        fs::write(src.join("sub").join("b.txt"), b"b").unwrap();
        let dst = base.join("dst");
        let stats = copy_dir(&src, &dst).unwrap();
        assert_eq!(stats.files, 2);
        assert_eq!(stats.skipped_links, 0);
        assert_eq!(fs::read(dst.join("sub").join("b.txt")).unwrap(), b"b");
        // Add-only never overwrites what's already there.
        fs::write(dst.join("a.txt"), b"edited").unwrap();
        fs::write(src.join("c.txt"), b"c").unwrap();
        let stats = copy_dir_add_only(&src, &dst).unwrap();
        assert_eq!(stats.files, 1, "only the new file is added");
        assert_eq!(fs::read(dst.join("a.txt")).unwrap(), b"edited");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn rail_target_unmasks_a_dotdot_spelling_of_a_root() {
        // A path with plenty of Normal segments that RESOLVES to the filesystem
        // root: safe-looking to the raw rails, refused once canonicalized.
        let base = unique_temp_dir("rail_canon");
        let deep = base.join("sub");
        fs::create_dir_all(&deep).unwrap();
        // Climb one level per Normal segment (plus one for the root itself —
        // Windows clamps any excess `..` at the drive root anyway).
        let ups = deep
            .components()
            .filter(|c| matches!(c, std::path::Component::Normal(_)))
            .count();
        let mut sneaky = deep.clone();
        for _ in 0..ups + 1 {
            sneaky.push("..");
        }
        // Raw, the spelling passes the shallow-path rail…
        assert!(unsafe_recursive_target(&sneaky).is_none());
        // …but the canonical target is the root, which the rail refuses.
        let canon = rail_target(&sneaky);
        assert!(
            unsafe_recursive_target(&canon).is_some(),
            "canonical form must be refused: {} → {}",
            sneaky.display(),
            canon.display()
        );
        // A missing path keeps its raw form (today's "not found" handling).
        let missing = Path::new("C:\\definitely\\not\\there\\dth_rail_test");
        assert_eq!(rail_target(missing), missing);
        let _ = fs::remove_dir_all(&base);
    }
}
