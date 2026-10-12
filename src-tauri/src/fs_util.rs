//! Shared file-writing helpers.

use std::io::Write;
use std::path::Path;

/// Replace `path` with `data` without ever leaving a truncated or missing file.
///
/// The bytes go to a temporary file in the same directory, are flushed to disk,
/// and the temporary file is then renamed over the target. If any step fails the
/// previous contents of `path` stay untouched and the temporary file is removed.
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    // Write through a symlink to its target instead of replacing the link.
    let resolved;
    let path = match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            resolved = std::fs::canonicalize(path)?;
            resolved.as_path()
        }
        _ => path,
    };
    let dir = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let mut temp = tempfile::Builder::new()
        .prefix(".papernest-")
        .suffix(".tmp")
        .tempfile_in(dir)?;
    temp.write_all(data)?;
    temp.as_file().sync_all()?;
    temp.persist(path).map_err(|e| e.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::write_atomic;

    #[test]
    fn creates_and_replaces_without_leaving_temporary_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.md");

        write_atomic(&path, b"first").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"first");
        write_atomic(&path, b"second, longer").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second, longer");

        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("doc.md")]);
    }

    #[test]
    fn failed_replace_keeps_the_target_and_cleans_up() {
        let dir = tempfile::tempdir().unwrap();
        // A directory cannot be replaced by a file, so the final rename fails.
        let target = dir.path().join("occupied");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("inner.txt"), b"keep").unwrap();

        assert!(write_atomic(&target, b"data").is_err());
        assert_eq!(std::fs::read(target.join("inner.txt")).unwrap(), b"keep");
        let names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("occupied")]);
    }
}
