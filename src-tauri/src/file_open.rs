//! Retain native file-open requests until the main frontend can consume them.
use std::path::Path;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct PendingFiles(Mutex<Vec<String>>);

pub fn files_from_args(args: &[String], cwd: &Path) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter_map(|arg| {
            let path = cwd.join(arg);
            path.is_file()
                .then(|| path.to_str().map(str::to_owned))
                .flatten()
        })
        .collect()
}

impl PendingFiles {
    pub fn push(&self, paths: impl IntoIterator<Item = String>) {
        self.0.lock().unwrap().extend(paths);
    }

    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

pub fn enqueue(app: &tauri::AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<PendingFiles>().push(paths);
    // The event is only a wake-up. The queue survives a missing listener.
    let _ = app.emit_to("main", "open-files-pending", ());
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[tauri::command]
pub fn take_pending_files(
    window: tauri::WebviewWindow,
    state: tauri::State<PendingFiles>,
) -> Result<Vec<String>, String> {
    if window.label() != "main" {
        return Err("Only the main window can consume native file-open requests.".into());
    }
    Ok(state.take())
}

/// Finder supplies file URLs; do not treat remote URLs as local paths.
#[cfg(any(target_os = "macos", test))]
pub fn local_files(urls: Vec<tauri::Url>) -> Vec<String> {
    urls.into_iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter_map(|path| path.to_str().map(str::to_owned))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_survive_startup_and_are_consumed_once_in_order() {
        let queue = PendingFiles::default();
        queue.push(["初稿 one.md".into(), "two.md".into()]);
        queue.push(["three.md".into()]);
        assert_eq!(queue.take(), ["初稿 one.md", "two.md", "three.md"]);
        assert!(queue.take().is_empty());
        queue.push(["later.md".into()]);
        assert_eq!(queue.take(), ["later.md"]);
    }

    #[test]
    fn file_urls_decode_unicode_spaces_and_literal_percent_only_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("中文 space %20 #.md");
        let urls = vec![
            tauri::Url::from_file_path(&path).unwrap(),
            tauri::Url::parse("https://example.invalid/file.md").unwrap(),
        ];
        assert_eq!(local_files(urls), [path.to_str().unwrap()]);
    }

    #[test]
    fn forwarded_relative_arguments_use_the_senders_directory_and_keep_all_files() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("中文 one.md");
        let second = dir.path().join("two.md");
        std::fs::write(&first, "one").unwrap();
        std::fs::write(&second, "two").unwrap();
        let args = vec![
            "PaperNest".into(),
            "中文 one.md".into(),
            second.to_str().unwrap().into(),
            "missing.md".into(),
            ".".into(),
        ];
        assert_eq!(
            files_from_args(&args, dir.path()),
            [first.to_str().unwrap(), second.to_str().unwrap()]
        );
    }
}
