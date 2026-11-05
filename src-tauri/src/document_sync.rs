//! Disk snapshots and optimistic concurrency for document saves.
use serde::Serialize;
use std::{
    hash::{DefaultHasher, Hash, Hasher},
    io::Read,
    path::Path,
    sync::Mutex,
};

// Serialize check-and-replace across this process's document windows.
static WRITES: Mutex<()> = Mutex::new(());
pub const CONFLICT: &str = "PAPERNEST_DOCUMENT_CONFLICT";

#[derive(Debug, Serialize)]
pub struct DocumentState {
    pub content: String,
    pub version: String,
    pub stamp: String,
}

#[derive(Serialize)]
pub struct DocumentStamp {
    pub path: String,
    pub stamp: Result<String, String>,
}

fn version(bytes: &[u8]) -> String {
    let mut hash = DefaultHasher::new();
    bytes.hash(&mut hash);
    format!("{}-{:016x}", bytes.len(), hash.finish())
}

fn stamp(meta: &std::fs::Metadata) -> Result<String, String> {
    if !meta.is_file() {
        return Err("Not a regular file".into());
    }
    let modified = meta
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    Ok(format!("{}-{}", meta.len(), modified.as_nanos()))
}

fn path_stamp(path: &str) -> Result<String, String> {
    stamp(&std::fs::metadata(path).map_err(|e| format!("Cannot inspect {path}: {e}"))?)
}

#[tauri::command]
pub async fn get_document_version(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(version(&bytes))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Cannot read {path}: {e}")),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_document_stamps(
    paths: Vec<String>,
    doc_path: Option<String>,
) -> Result<Vec<DocumentStamp>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_iter()
            .map(|path| {
                let stamp = match doc_path.as_deref() {
                    Some(doc) => crate::assets::resolve_local_path(Some(doc), &path)
                        .and_then(|resolved| path_stamp(&resolved.to_string_lossy())),
                    None => path_stamp(&path),
                };
                DocumentStamp { path, stamp }
            })
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

fn read_state(path: &str) -> Result<DocumentState, String> {
    let mut file = std::fs::File::open(path).map_err(|e| format!("Cannot read {path}: {e}"))?;
    let before = stamp(&file.metadata().map_err(|e| e.to_string())?)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read {path}: {e}"))?;
    if before != stamp(&file.metadata().map_err(|e| e.to_string())?)? {
        return Err(format!("File changed while reading: {path}"));
    }
    let version = version(&bytes);
    let content = crate::commands::document_text(path, bytes)?;
    Ok(DocumentState {
        content,
        version,
        stamp: before,
    })
}

#[tauri::command]
pub async fn read_document_state(path: String) -> Result<DocumentState, String> {
    tauri::async_runtime::spawn_blocking(move || read_state(&path))
        .await
        .map_err(|e| e.to_string())?
}

/// None means a new destination: never replace a file created after the picker.
#[tauri::command]
pub async fn write_document_checked(
    path: String,
    contents: String,
    expected_version: Option<String>,
) -> Result<DocumentState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = WRITES.lock().unwrap();
        let formatted = crate::commands::format_document(&path, contents);
        let metadata =
            crate::fs_util::write_atomic_checked(Path::new(&path), formatted.as_bytes(), || {
                let current = match std::fs::read(&path) {
                    Ok(bytes) => Some(version(&bytes)),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
                    Err(e) => return Err(e),
                };
                if current != expected_version {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::WouldBlock,
                        CONFLICT,
                    ));
                }
                Ok(())
            })
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::WouldBlock {
                    CONFLICT.to_string()
                } else {
                    format!("Cannot write {path}: {e}")
                }
            })?;
        Ok(DocumentState {
            version: version(formatted.as_bytes()),
            content: formatted,
            stamp: stamp(&metadata)?,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, text: &str, expected: Option<String>) -> Result<DocumentState, String> {
        tauri::async_runtime::block_on(write_document_checked(
            path.display().to_string(),
            text.into(),
            expected,
        ))
    }

    #[test]
    fn stale_save_and_deleted_file_are_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.md");
        std::fs::write(&path, "original\r\n").unwrap();
        let original = read_state(path.to_str().unwrap()).unwrap();
        assert_eq!(original.content, "original\r\n");
        std::fs::write(&path, "external\r\n").unwrap();
        assert_eq!(
            write(&path, "local", Some(original.version.clone())).unwrap_err(),
            CONFLICT
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "external\r\n");
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            write(&path, "local", Some(original.version)).unwrap_err(),
            CONFLICT
        );
        assert!(!path.exists());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn fresh_save_returns_the_actual_formatted_baseline() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.md");
        let first = write(&path, "| a | b |\n|---|---|\n| longer | c |", None).unwrap();
        let disk = read_state(path.to_str().unwrap()).unwrap();
        assert_eq!(first.content, disk.content);
        assert_eq!(first.version, disk.version);
        assert_eq!(first.stamp, disk.stamp);
        assert!(write(&path, "collision", None).is_err());
        let second = write(&path, "next", Some(first.version)).unwrap();
        assert_eq!(second.content, "next");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "next");
    }

    #[test]
    fn competing_windows_cannot_both_save_the_same_version() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("doc.txt");
        std::fs::write(&path, "original").unwrap();
        let expected = read_state(path.to_str().unwrap()).unwrap().version;
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let workers: Vec<_> = ["window one", "window two"]
            .into_iter()
            .map(|text| {
                let path = path.clone();
                let expected = expected.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    write(&path, text, Some(expected))
                })
            })
            .collect();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, Err(e) if e == CONFLICT))
                .count(),
            1
        );
        let winner = results.into_iter().find_map(Result::ok).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), winner.content);
    }
}
