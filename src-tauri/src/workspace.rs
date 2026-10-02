use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Serialize)]
pub struct WorkspaceEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize)]
pub struct WorkspaceDirectory {
    path: String,
    parent: Option<String>,
    entries: Vec<WorkspaceEntry>,
}

fn display(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn checked_dir(path: &str) -> Result<PathBuf, String> {
    // Keep ordinary Windows paths rather than canonical `\\?\` paths so the
    // frontend can compare tree entries with paths received from Explorer.
    let dir = PathBuf::from(path);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", dir.display()));
    }
    Ok(dir)
}

fn checked_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        || name.ends_with(['.', ' '])
    {
        return Err("Enter a single valid file or folder name.".into());
    }
    Ok(name)
}

fn entry(path: &Path) -> Result<WorkspaceEntry, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(WorkspaceEntry {
        name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        path: display(path),
        is_dir: metadata.is_dir(),
    })
}

#[tauri::command]
pub fn list_workspace_dir(path: String) -> Result<WorkspaceDirectory, String> {
    let dir = checked_dir(&path)?;
    let mut entries = Vec::new();
    for item in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name();
        if name.to_string_lossy().starts_with('.') || item.file_type().map_err(|e| e.to_string())?.is_symlink() {
            continue;
        }
        if let Ok(value) = entry(&item.path()) {
            entries.push(value);
        }
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(WorkspaceDirectory {
        path: display(&dir),
        parent: dir.parent().map(display),
        entries,
    })
}

#[tauri::command]
pub fn search_workspace(root: String, query: String) -> Result<Vec<WorkspaceEntry>, String> {
    let root = checked_dir(&root)?;
    let query = query.trim().to_lowercase();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let mut found = Vec::new();
    let mut pending = vec![root];
    let mut visited = 0usize;
    while let Some(dir) = pending.pop() {
        if visited >= 10_000 || found.len() >= 200 { break; }
        visited += 1;
        let Ok(items) = fs::read_dir(&dir) else { continue; };
        for item in items.flatten() {
            let name = item.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') { continue; }
            let Ok(kind) = item.file_type() else { continue; };
            if kind.is_symlink() { continue; }
            let path = item.path();
            if name.to_lowercase().contains(&query) {
                if let Ok(value) = entry(&path) { found.push(value); }
                if found.len() >= 200 { break; }
            }
            if kind.is_dir() { pending.push(path); }
        }
    }
    found.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(found)
}

/// Resolve a Markdown link beside its source document and return an ordinary
/// filesystem path that can be compared with open tabs and shown in the tree.
#[tauri::command]
pub fn resolve_workspace_link(doc_path: String, href: String) -> Result<String, String> {
    let raw = href.trim().split(['#', '?']).next().unwrap_or_default();
    if raw.is_empty() || raw.starts_with("//") || raw.contains("://") {
        return Err("This is not a local document link.".into());
    }
    let decoded = crate::assets::percent_decode(raw);
    let target = PathBuf::from(decoded.replace('/', std::path::MAIN_SEPARATOR_STR));
    let path = if target.is_absolute() {
        target
    } else {
        Path::new(&doc_path).parent().ok_or("The current document has no folder.")?.join(target)
    };
    let resolved = fs::canonicalize(&path).map_err(|e| format!("Cannot open {}: {e}", path.display()))?;
    if !resolved.is_file() { return Err(format!("Not a file: {}", resolved.display())); }
    let shown = display(&resolved);
    #[cfg(target_os = "windows")]
    let shown = if let Some(unc) = shown.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else if let Some(local) = shown.strip_prefix(r"\\?\") {
        local.to_owned()
    } else { shown };
    Ok(shown)
}

#[tauri::command]
pub fn create_workspace_entry(parent: String, name: String, directory: bool) -> Result<String, String> {
    let target = checked_dir(&parent)?.join(checked_name(&name)?);
    if directory {
        fs::create_dir(&target).map_err(|e| e.to_string())?;
    } else {
        fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(|e| e.to_string())?;
    }
    Ok(display(&target))
}

#[tauri::command]
pub fn duplicate_workspace_file(path: String) -> Result<String, String> {
    let source = Path::new(&path);
    if !source.is_file() { return Err("Select a file to duplicate.".into()); }
    let parent = source.parent().ok_or("File has no parent directory")?;
    let stem = source.file_stem().unwrap_or_default().to_string_lossy();
    let ext = source.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for index in 1..=999 {
        let suffix = if index == 1 { " copy".to_owned() } else { format!(" copy {index}") };
        let target = parent.join(format!("{stem}{suffix}{ext}"));
        if !target.exists() {
            fs::copy(source, &target).map_err(|e| e.to_string())?;
            return Ok(display(&target));
        }
    }
    Err("Could not find an available copy name.".into())
}

#[tauri::command]
pub fn rename_workspace_entry(path: String, name: String) -> Result<String, String> {
    let source = Path::new(&path);
    if !source.exists() { return Err("File or folder does not exist.".into()); }
    let target = source.parent().ok_or("Entry has no parent directory")?.join(checked_name(&name)?);
    if target == source { return Ok(display(source)); }
    if target.exists() { return Err("A file or folder with this name already exists.".into()); }
    fs::rename(source, &target).map_err(|e| e.to_string())?;
    Ok(display(&target))
}

#[tauri::command]
pub async fn delete_workspace_entry(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        // Use a fresh thread for the Shell's STA, independent of WebView2 and
        // the runtime pool's COM apartment. Do not block the UI during recycling.
        std::thread::spawn(move || crate::recycle::move_to_trash(Path::new(&path)))
            .join().map_err(|_| "Could not move the item to the recycle bin.".to_owned())?
    }).await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "windows")]
fn open_in_explorer(path: &Path) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED};
    use windows_sys::Win32::UI::Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName, ShellExecuteW};
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    // Canonicalization removes duplicate separators from paths supplied by
    // Explorer. Shell APIs expect a regular drive/UNC path, not a \\?\ path.
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    let canonical = canonical.to_string_lossy();
    let shell_path = if let Some(unc) = canonical.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else if let Some(local) = canonical.strip_prefix(r"\\?\") {
        local.to_owned()
    } else {
        canonical.into_owned()
    };
    let wide: Vec<u16> = OsStr::new(&shell_path).encode_wide().chain(Some(0)).collect();

    // Run on a fresh thread so COM can use the apartment required by the
    // Shell, independently of Tauri/WebView2's event loop apartment.
    let init = unsafe { CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32) };
    if init < 0 { return Err(format!("COM initialization failed: {init:#x}")); }
    let result = unsafe {
        if path.is_dir() {
            let opened = ShellExecuteW(
                std::ptr::null_mut(), std::ptr::null(), wide.as_ptr(),
                std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL,
            );
            if opened as isize <= 32 { Err(format!("Could not open folder: {}", shell_path)) }
            else { Ok(()) }
        } else {
            let mut pidl = std::ptr::null_mut();
            let parsed = SHParseDisplayName(
                wide.as_ptr(), std::ptr::null_mut(), &mut pidl, 0, std::ptr::null_mut(),
            );
            let result = if parsed < 0 {
                Err(format!("Could not locate file in Explorer: {parsed:#x}"))
            } else {
                let opened = SHOpenFolderAndSelectItems(pidl, 0, std::ptr::null(), 0);
                if opened < 0 { Err(format!("Could not select file in Explorer: {opened:#x}")) }
                else { Ok(()) }
            };
            CoTaskMemFree(pidl.cast());
            result
        }
    };
    unsafe { CoUninitialize() };
    result
}

#[tauri::command]
pub async fn open_workspace_location(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() { return Err("File or folder does not exist.".into()); }
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            std::thread::spawn(move || open_in_explorer(Path::new(&path)))
                .join().map_err(|_| "Could not open File Explorer.".to_string())?
        }).await.map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open")
            .arg(if target.is_file() { target.parent().unwrap_or(target) } else { target })
            .spawn().map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[tauri::command]
pub async fn open_workspace_window(app: AppHandle, path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.is_file() { return Err("File does not exist.".into()); }
    let script = format!(
        "window.__PAPERNEST_LAUNCH = {{ kind: 'workspace_file', path: {} }};",
        serde_json::to_string(&path).map_err(|e| e.to_string())?,
    );
    let label = format!("workspace-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos());
    // Keep secondary WebViews alongside the main profile, including portable
    // mode. Never mutate the process environment while windows are starting.
    #[cfg(target_os = "windows")]
    let data_base = app.config().app.windows.iter().find(|w| w.label == "main")
        .and_then(|w| w.data_directory.as_ref())
        .and_then(|dir| dir.parent()).map(Path::to_path_buf);
    #[cfg(not(target_os = "windows"))]
    let data_base: Option<PathBuf> = None;
    let data_base = match data_base {
        Some(base) => base,
        None => app.path().app_local_data_dir().map_err(|e| e.to_string())?,
    };
    let data_dir = data_base.join("workspace-webviews").join(&label);
    WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
        .data_directory(data_dir)
        .initialization_script(script)
        .title("PaperNest")
        .decorations(!cfg!(target_os = "windows"))
        .inner_size(880.0, 700.0)
        .min_inner_size(480.0, 360.0)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod link_tests {
    use super::resolve_workspace_link;
    use std::fs;

    #[test]
    fn relative_markdown_link_resolves_parent_and_encoded_space() {
        let root = std::env::temp_dir().join(format!(
            "mdmeow-link-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(root.join("notes")).unwrap();
        fs::write(root.join("a b.md"), "# target").unwrap();
        let source = root.join("notes").join("index.md");
        fs::write(&source, "[target](../a%20b.md#intro)").unwrap();
        let result = resolve_workspace_link(source.to_string_lossy().into_owned(), "../a%20b.md#intro".into()).unwrap();
        assert_eq!(std::path::Path::new(&result).file_name().unwrap(), "a b.md");
        assert!(std::path::Path::new(&result).is_file());
        assert!(resolve_workspace_link(source.to_string_lossy().into_owned(), "https://example.com".into()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
