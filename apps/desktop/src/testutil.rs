use std::fs;
use std::path::{Path, PathBuf};

/// A unique, freshly-cleared temp dir for a filesystem test (no `tempfile` dep).
pub(crate) fn unique_temp_dir(tag: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static N: AtomicU32 = AtomicU32::new(0);
    let n = N.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("dth_test_{tag}_{}_{n}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    dir
}

/// Write a zip at `path` whose file entries are (name, bytes).
pub(crate) fn write_zip(path: &Path, files: &[(&str, &[u8])]) {
    let mut w = zip::ZipWriter::new(fs::File::create(path).unwrap());
    for (name, data) in files {
        w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        std::io::Write::write_all(&mut w, data).unwrap();
    }
    w.finish().unwrap();
}

/// A zip's raw bytes, for nesting one archive inside another.
pub(crate) fn zip_bytes(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    for (name, data) in files {
        w.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
        std::io::Write::write_all(&mut w, data).unwrap();
    }
    w.finish().unwrap().into_inner()
}

/// The store wrapper layout: the download zip holds PDFs + a `.dsx` manifest
/// beside the real DIM package zip, whose content lives under `Content/`.
pub(crate) fn write_wrapper_zip(path: &Path) {
    let inner = zip_bytes(&[
        ("Manifest.dsx", b"<manifest/>".as_slice()),
        ("Content/data/Meipe/morph.dsf", b"morph-data".as_slice()),
        ("Content/Runtime/Textures/t.png", b"png".as_slice()),
        ("Content/Documentation/read.pdf", b"pdf".as_slice()),
    ]);
    write_zip(
        path,
        &[
            ("EndUserLicense.pdf", b"eula".as_slice()),
            ("IM80067582-01_Product.dsx", b"<dsx/>".as_slice()),
            ("IM80067582-01_Product.zip", inner.as_slice()),
        ],
    );
}
