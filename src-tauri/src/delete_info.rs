//! Read-only, bounded reference analysis for the deletion confirmation.
use std::{fs, path::{Path, PathBuf}};
use comrak::{Arena, Options, parse_document, nodes::NodeValue};
use serde::Serialize;

const MAX_ENTRIES: usize = 20_000;
const MAX_DOCUMENT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 32 * 1024 * 1024;

#[derive(Serialize)]
pub struct Backlink { path: String, name: String, count: usize }

#[derive(Serialize)]
pub struct DeleteInfo {
    is_dir: bool,
    file_count: usize,
    file_count_complete: bool,
    backlink_count: usize,
    backlink_file_count: usize,
    backlinks: Vec<Backlink>,
    scan_complete: bool,
}

fn markdown(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s|
        ["md", "markdown", "mdx"].iter().any(|ext| s.eq_ignore_ascii_case(ext)))
}

fn collect(root: &Path, visible_only: bool) -> (Vec<PathBuf>, bool) {
    let mut paths = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    let mut complete = true;
    let mut visited = 0;
    while let Some(path) = pending.pop() {
        visited += 1;
        if visited > MAX_ENTRIES { complete = false; break; }
        let Ok(metadata) = fs::symlink_metadata(&path) else { complete = false; continue; };
        if metadata.file_type().is_symlink() { continue; }
        if metadata.is_dir() {
            let Ok(entries) = fs::read_dir(&path) else { complete = false; continue; };
            for item in entries {
                let Ok(item) = item else { complete = false; continue; };
                let name = item.file_name();
                if visible_only && (name.to_string_lossy().starts_with('.') || name == "node_modules") { continue; }
                // Bound the pending list as well as traversal on very wide directories.
                if pending.len() + visited >= MAX_ENTRIES { complete = false; break; }
                pending.push(item.path());
            }
        } else if metadata.is_file() { paths.push(path); }
    }
    (paths, complete)
}

fn matches_target(path: &Path, target: &Path, directory: bool) -> bool {
    path == target || (directory && path.starts_with(target))
}

fn destination(source: &Path, root: &Path, href: &str, wiki: bool, files: &[PathBuf]) -> Option<PathBuf> {
    let raw = href.split(['#', '?']).next()?.trim();
    if raw.is_empty() || raw.starts_with("//") || raw.contains("://") || raw.starts_with("mailto:") { return None; }
    let decoded = crate::assets::percent_decode(raw).replace('/', std::path::MAIN_SEPARATOR_STR);
    let relative = PathBuf::from(&decoded);
    let mut candidates = vec![source.parent()?.join(&relative)];
    if relative.is_absolute() { candidates.insert(0, relative.clone()); }
    if wiki {
        candidates.insert(0, root.join(&relative));
        let with_extension: Vec<_> = candidates.iter().filter(|path| path.extension().is_none()).map(|path| path.with_extension("md")).collect();
        candidates.extend(with_extension);
    }
    for path in candidates {
        if let Ok(path) = fs::canonicalize(path) { return Some(path); }
    }
    // Obsidian's shortest wiki links resolve only when the basename is unique.
    if wiki && !raw.contains(['/', '\\']) {
        let named: Vec<_> = files.iter().filter(|path|
            path.file_stem().and_then(|s| s.to_str()).is_some_and(|s| s == raw)
            || path.file_name().and_then(|s| s.to_str()).is_some_and(|s| s == raw)).collect();
        if named.len() == 1 { return fs::canonicalize(named[0]).ok(); }
    }
    None
}

fn analyse(root: String, path: String) -> Result<DeleteInfo, String> {
    let target = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let root = fs::canonicalize(&root).map_err(|e| e.to_string())?;
    if !root.is_dir() || !target.starts_with(&root) { return Err("Target is outside the current workspace.".into()); }
    let is_dir = target.is_dir();
    let (targets, file_count_complete) = collect(&target, false);
    let (files, mut scan_complete) = collect(&root, true);
    let mut info = DeleteInfo { is_dir, file_count: targets.len(), file_count_complete,
        backlink_count: 0, backlink_file_count: 0, backlinks: vec![], scan_complete: true };
    let mut options = Options::default();
    options.extension.wikilinks_title_after_pipe = true;
    let mut total_bytes = 0;
    for source in &files {
        if !markdown(source) || matches_target(source, &target, is_dir) { continue; }
        let Ok(metadata) = fs::metadata(source) else { scan_complete = false; continue; };
        if metadata.len() > MAX_DOCUMENT_BYTES { scan_complete = false; continue; }
        total_bytes += metadata.len();
        if total_bytes > MAX_TOTAL_BYTES { scan_complete = false; break; }
        let Ok(text) = fs::read_to_string(source) else { scan_complete = false; continue; };
        let arena = Arena::new();
        let document = parse_document(&arena, &text, &options);
        let mut count = 0;
        for node in document.descendants() {
            let data = node.data.borrow();
            let link = match &data.value {
                NodeValue::Link(link) | NodeValue::Image(link) => Some((link.url.as_str(), false)),
                NodeValue::WikiLink(link) => Some((link.url.as_str(), true)),
                _ => None,
            };
            if let Some((href, wiki)) = link {
                if destination(source, &root, href, wiki, &files).is_some_and(|dest| matches_target(&dest, &target, is_dir)) { count += 1; }
            }
        }
        if count > 0 {
            info.backlink_count += count;
            info.backlink_file_count += 1;
            if info.backlinks.len() < 200 {
                info.backlinks.push(Backlink { path: source.to_string_lossy().into_owned(),
                    name: source.strip_prefix(&root).unwrap_or(source).to_string_lossy().into_owned(), count });
            }
        }
    }
    info.backlinks.sort_by(|a, b| a.name.cmp(&b.name));
    info.scan_complete = scan_complete;
    Ok(info)
}

#[tauri::command]
pub async fn get_workspace_delete_info(root: String, path: String) -> Result<DeleteInfo, String> {
    tauri::async_runtime::spawn_blocking(move || analyse(root, path)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_real_links_and_directory_files_without_code_samples() {
        let root = std::env::temp_dir().join(format!("papernest-delete-info-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::write(root.join("notes/target file.md"), "# Target").unwrap();
        fs::write(root.join("notes/extra.txt"), "text").unwrap();
        fs::write(root.join("index.md"), "[one](notes/target%20file.md#heading)\n[two][ref]\n\n[ref]: notes/target%20file.md\n\n[[notes/target file|alias]]\n\n`[fake](notes/target%20file.md)`\n\n```md\n[[notes/target file]]\n```\n[external](https://example.com/notes/target%20file.md)").unwrap();
        let file = analyse(root.to_string_lossy().into_owned(), root.join("notes/target file.md").to_string_lossy().into_owned()).unwrap();
        assert_eq!(file.file_count, 1);
        assert_eq!(file.backlink_count, 3);
        assert_eq!(file.backlink_file_count, 1);
        assert!(file.scan_complete);
        let directory = analyse(root.to_string_lossy().into_owned(), root.join("notes").to_string_lossy().into_owned()).unwrap();
        assert_eq!(directory.file_count, 2);
        assert_eq!(directory.backlink_count, 3);
        assert!(root.join("notes/target file.md").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
