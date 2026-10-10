//! Share reading state between installed and portable executables for this user.
//! Preferences other than session restore remain in each build's settings file.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::settings::Settings;

#[derive(Debug, Serialize, Deserialize)]
struct ReadingSession {
    open_last_session: bool,
    open_files: Vec<PathBuf>,
    active_tab: usize,
    open_file_scroll_positions: Vec<f64>,
    session_source_mode: bool,
    session_workspace_root: Option<String>,
}

fn path() -> Option<PathBuf> {
    crate::portable::config_base().map(|base| base.join("PaperNest/reading-session.toml"))
}

pub fn load(settings_path: &Path, settings: &mut Settings) {
    if let Some(path) = path() {
        load_from(&path, settings_path, settings);
    }
}

fn load_from(path: &Path, settings_path: &Path, settings: &mut Settings) {
    let Ok(shared_time) = std::fs::metadata(path).and_then(|meta| meta.modified()) else { return; };
    // An older executable can still update its own settings. Prefer that more
    // recent local record over a stale shared record when it exists.
    if std::fs::metadata(settings_path).and_then(|meta| meta.modified())
        .is_ok_and(|local_time| local_time > shared_time) { return; }
    let Ok(raw) = std::fs::read_to_string(path) else { return; };
    let Ok(session) = toml::from_str::<ReadingSession>(&raw) else { return; };
    settings.open_last_session = session.open_last_session;
    settings.open_files = session.open_files;
    settings.active_tab = session.active_tab;
    settings.open_file_scroll_positions = session.open_file_scroll_positions;
    settings.session_source_mode = session.session_source_mode;
    settings.session_workspace_root = session.session_workspace_root;
}

pub fn save(settings: &Settings) -> anyhow::Result<()> {
    if let Some(path) = path() { save_to(&path, settings)?; }
    Ok(())
}

fn save_to(path: &Path, settings: &Settings) -> anyhow::Result<()> {
    let session = ReadingSession {
        open_last_session: settings.open_last_session,
        open_files: settings.open_files.clone(),
        active_tab: settings.active_tab,
        open_file_scroll_positions: settings.open_file_scroll_positions.clone(),
        session_source_mode: settings.session_source_mode,
        session_workspace_root: settings.session_workspace_root.clone(),
    };
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
    crate::fs_util::write_atomic(path, toml::to_string_pretty(&session)?.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shares_session_and_switch_across_executables_without_copying_other_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let shared = dir.path().join("shared/session.toml");
        let mut source = Settings::default();
        source.open_files = vec!["C:/文档/a.md".into(), "C:/文档/b.md".into()];
        source.active_tab = 1;
        source.open_file_scroll_positions = vec![120.0, 876.5];
        source.session_source_mode = true;
        source.session_workspace_root = Some("C:/文档".into());
        source.open_last_session = false;
        save_to(&shared, &source).unwrap();
        let mut portable = Settings::default();
        portable.accent = "#123456".into();
        load_from(&shared, &dir.path().join("other-exe/settings.toml"), &mut portable);
        assert_eq!(portable.open_files, source.open_files);
        assert_eq!(portable.active_tab, 1);
        assert_eq!(portable.open_file_scroll_positions, vec![120.0, 876.5]);
        assert_eq!(portable.session_workspace_root, source.session_workspace_root);
        assert!(portable.session_source_mode);
        assert!(!portable.open_last_session);
        assert_eq!(portable.accent, "#123456");
    }

    #[test]
    fn missing_or_invalid_shared_record_preserves_local_session() {
        let dir = tempfile::tempdir().unwrap();
        let shared = dir.path().join("session.toml");
        let mut settings = Settings::default();
        settings.open_files = vec!["local.md".into()];
        load_from(&shared, &dir.path().join("settings.toml"), &mut settings);
        std::fs::write(&shared, "broken = [").unwrap();
        load_from(&shared, &dir.path().join("settings.toml"), &mut settings);
        assert_eq!(settings.open_files, vec![PathBuf::from("local.md")]);
    }

    #[test]
    fn a_more_recent_legacy_settings_file_wins_over_shared_state() {
        let dir = tempfile::tempdir().unwrap();
        let shared = dir.path().join("session.toml");
        save_to(&shared, &Settings::default()).unwrap();
        let local = dir.path().join("settings.toml");
        std::fs::write(&local, "fixture").unwrap();
        let shared_time = std::fs::metadata(&shared).unwrap().modified().unwrap();
        std::fs::File::options().write(true).open(&local).unwrap()
            .set_times(std::fs::FileTimes::new().set_modified(shared_time + std::time::Duration::from_secs(1))).unwrap();
        let mut settings = Settings::default();
        settings.open_files = vec!["legacy.md".into()];
        load_from(&shared, &local, &mut settings);
        assert_eq!(settings.open_files, vec![PathBuf::from("legacy.md")]);
    }
}
