//! `settings.toml` — the single settings file.
//!
//! Windows portable mode stores it next to the versioned EXE. Installed bundles
//! (Windows MSI, Linux packages/AppImage, macOS app bundles) store it under the
//! platform user config directory. External edits are picked up live by `watch()`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::portable;

pub const SETTINGS_CHANGED_EVENT: &str = "settings-changed";

/// (size, mtime-millis) — a cheap change signature for `settings.toml`.
pub type Signature = (u64, u128);
pub type LastWrite = Arc<Mutex<Option<Signature>>>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WindowState {
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub maximized: bool,
    /// 0/1 = legacy logical coordinates, 2 = physical outer-frame position.
    pub geometry_version: u8,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 900.0,
            height: 680.0,
            x: None,
            y: None,
            maximized: false,
            geometry_version: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ShortcutSettings {
    pub new_tab: String,
    pub open: String,
    pub save: String,
    pub save_as: String,
    pub close_tab: String,
    pub export: String,
    pub toggle_source: String,
    pub find: String,
    pub replace: String,
    pub emoji: String,
    pub settings: String,
}

impl Default for ShortcutSettings {
    fn default() -> Self {
        Self {
            new_tab: "Mod+N".to_string(),
            open: "Mod+O".to_string(),
            save: "Mod+S".to_string(),
            save_as: "Mod+Shift+S".to_string(),
            close_tab: "Mod+W".to_string(),
            export: "Mod+E".to_string(),
            toggle_source: "Mod+/".to_string(),
            find: "Mod+F".to_string(),
            replace: "Mod+H".to_string(),
            emoji: "Mod+.".to_string(),
            settings: "Mod+,".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    // --- hand-editable preferences ---
    /// UI language: "system" (OS locale) | "en" | "de" | "ja" | "zh-CN"
    pub language: String,
    pub spellcheck: bool,
    /// When true, pressing Esc quits the app.
    pub quit_on_escape: bool,
    /// Bullet-list marker written on save: "*", "-" or "+".
    pub list_marker: String,
    /// Show the full file path (not just the file name) in the editor header.
    pub show_path: bool,
    /// Reopen the previous session's tabs on startup.
    pub open_last_session: bool,
    /// Keep the tab bar visible even when only one file is open.
    pub always_show_tabbar: bool,
    /// Only show Markdown (.md/.markdown/.mdx) files and directories containing them in the workspace tree.
    pub markdown_only: bool,
    /// WYSIWYG editor font family ("" = built-in default).
    pub editor_font: String,
    /// Base editor font size in px (headings scale from this).
    pub editor_font_size: u16,
    /// Markdown source-view font family ("" = built-in monospace).
    pub source_font: String,
    pub source_font_size: u16,
    /// Alternate row tint in Markdown source / Code mode.
    pub code_alternate_rows: bool,
    /// Background colour used for alternating rows in Code mode.
    pub code_alternate_row_color: String,
    /// Restore the previous window position and size on startup.
    pub remember_window_position: bool,
    /// File extensions the user wants PaperNest registered to open on Windows.
    pub file_associations: Vec<String>,
    /// Windows Explorer New > MD File, independent of default applications.
    pub windows_new_md: bool,
    /// Accent colour. PaperNest defaults to Obsidian purple (#8A5CF5).
    pub accent: String,
    /// Base colour scheme: system, light or dark.
    pub color_scheme: String,
    /// Ask before deleting entries; does not suppress unsaved-change warnings.
    pub confirm_delete: bool,
    /// Route remote assets through a user-specified HTTP/HTTPS/SOCKS5 proxy.
    pub proxy_enabled: bool,
    /// Proxy endpoint, e.g. http://127.0.0.1:7897 or socks5://127.0.0.1:7893.
    pub proxy_url: String,
    /// Check for new versions in the background.
    pub auto_check_updates: bool,
    /// User-configurable application shortcuts.
    pub shortcuts: ShortcutSettings,

    // --- app-managed state ---
    /// Suppress the startup prompt asking to register PaperNest in Windows Open With.
    pub open_with_prompt_dismissed: bool,
    /// Epoch seconds of the most recent automatic version check attempt.
    pub last_update_check: u64,
    /// Files to reopen on next launch (session restore).
    pub open_files: Vec<PathBuf>,
    /// Index into `open_files` of the tab that was active.
    pub active_tab: usize,
    /// Preferred workspace sidebar width in CSS pixels (0 = responsive default).
    pub sidebar_width: f64,
    pub window: WindowState,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: "system".to_string(),
            spellcheck: true,
            quit_on_escape: false,
            list_marker: "*".to_string(),
            show_path: false,
            open_last_session: true,
            always_show_tabbar: false,
            markdown_only: true,
            editor_font: String::new(),
            editor_font_size: 16,
            source_font: String::new(),
            source_font_size: 15,
            code_alternate_rows: true,
            code_alternate_row_color: String::new(),
            remember_window_position: false,
            file_associations: vec![
                ".md".to_string(),
                ".markdown".to_string(),
                ".mdx".to_string(),
            ],
            windows_new_md: false,
            accent: "#8A5CF5".to_string(),
            color_scheme: "system".to_string(),
            confirm_delete: true,
            proxy_enabled: false,
            proxy_url: String::new(),
            auto_check_updates: false,
            shortcuts: ShortcutSettings::default(),
            open_with_prompt_dismissed: false,
            last_update_check: 0,
            open_files: Vec::new(),
            active_tab: 0,
            sidebar_width: 0.0,
            window: WindowState::default(),
        }
    }
}

/// Where settings live and whether that location is the portable program folder.
#[derive(Debug, Clone)]
pub struct Store {
    pub path: PathBuf,
    pub portable: bool,
    /// True only when a Windows portable build wanted to keep settings beside
    /// the executable but that directory was not writable, so settings were
    /// moved to the normal per-user config directory.
    pub fallback: bool,
}

impl Store {
    /// Decide the settings location once at startup from the explicit runtime mode.
    pub fn locate() -> Self {
        if portable::current_mode() == portable::InstallMode::Portable {
            let dir = portable::portable_dir().unwrap_or_else(std::env::temp_dir);
            if directory_is_writable(&dir) {
                let _ = std::fs::create_dir_all(dir.join("data"));
                return Self {
                    path: dir.join("settings.toml"),
                    portable: true,
                    fallback: false,
                };
            }

            // A portable executable can still be launched from a protected
            // directory. Preserve settings by falling back to the normal user
            // config directory, and expose that exceptional case to the UI.
            return installed_store(true);
        }

        installed_store(false)
    }

    /// Read settings. A missing file is a first run and yields defaults.
    ///
    /// A file that exists but cannot be read or parsed (usually a hand edit
    /// with a typo) is copied aside before defaults are returned, because the
    /// next save writes the whole struct back and would otherwise erase it.
    pub fn load(&self) -> (Settings, Option<LoadIssue>) {
        let error = match std::fs::read_to_string(&self.path) {
            Ok(raw) => match parse_settings(&raw) {
                Ok(settings) => return (settings, None),
                Err(e) => e.to_string(),
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return (Settings::default(), None)
            }
            Err(e) => e.to_string(),
        };
        eprintln!("settings: cannot load {}: {error}", self.path.display());
        (Settings::default(), Some(self.set_aside(error)))
    }

    fn set_aside(&self, error: String) -> LoadIssue {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let backup = self.path.with_file_name(format!("settings.invalid-{stamp}.toml"));
        match std::fs::copy(&self.path, &backup) {
            Ok(_) => LoadIssue {
                error,
                backup: Some(backup.display().to_string()),
            },
            Err(e) => {
                eprintln!("settings: cannot back up to {}: {e}", backup.display());
                LoadIssue { error, backup: None }
            }
        }
    }

    /// Write settings; returns the signature of the file just written.
    pub fn save(&self, settings: &Settings) -> anyhow::Result<Signature> {
        let body = toml::to_string_pretty(settings)?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        crate::fs_util::write_atomic(&self.path, body.as_bytes())?;
        signature(&self.path).ok_or_else(|| anyhow::anyhow!("cannot stat {}", self.path.display()))
    }
}

/// Why `settings.toml` could not be used, and where the original was copied.
#[derive(Debug, Clone, Serialize)]
pub struct LoadIssue {
    pub error: String,
    pub backup: Option<String>,
}

fn installed_store(fallback: bool) -> Store {
    let base = portable::config_base().unwrap_or_else(std::env::temp_dir);
    let dir = base.join("PaperNest");
    let path = dir.join("settings.toml");
    if !path.exists() {
        let legacy = base.join("Mowl").join("settings.toml");
        if legacy.is_file() {
            if let Err(e) = std::fs::create_dir_all(&dir).and_then(|_| std::fs::copy(&legacy, &path)) {
                eprintln!("settings: cannot migrate {}: {e}", legacy.display());
            }
        }
    }
    let _ = std::fs::create_dir_all(&dir);
    Store {
        path,
        portable: false,
        fallback,
    }
}

fn directory_is_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }

    let probe = dir.join(format!(".mdmeow-write-probe-{}", std::process::id()));
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(probe);
            true
        }
        Err(_) => false,
    }
}
fn signature(path: &Path) -> Option<Signature> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    Some((meta.len(), mtime))
}

/// Poll `settings.toml` once a second; when it changes on disk from something
/// other than our own last write (i.e. a hand edit), reload and emit
/// `settings-changed` so the UI can update without a restart.
pub fn watch(path: PathBuf, last_write: LastWrite, app: AppHandle) {
    let mut seen = signature(&path);
    loop {
        std::thread::sleep(Duration::from_millis(1000));
        let now = signature(&path);
        if now == seen {
            continue;
        }
        seen = now;
        if now.is_some() && *last_write.lock().unwrap() == now {
            continue; // this was our own save
        }
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        match parse_settings(&raw) {
            Ok(settings) => {
                let _ = app.emit(SETTINGS_CHANGED_EVENT, settings);
            }
            // Keep the live settings; the next save will still overwrite the
            // broken edit, but a restart backs it up first (see `Store::load`).
            Err(e) => eprintln!("settings: ignoring invalid edit of {}: {e}", path.display()),
        }
    }
}

/// Migrate the previous built-in colours once, leaving custom colours intact.
/// New files contain color_scheme, so choosing teal explicitly remains possible.
fn parse_settings(raw: &str) -> Result<Settings, toml::de::Error> {
    let mut settings: Settings = toml::from_str(raw)?;
    let values: toml::Value = toml::from_str(raw)?;
    if values.get("color_scheme").is_none() {
        if settings.accent.eq_ignore_ascii_case("#39C5BB") {
            settings.accent = "#8A5CF5".to_string();
        }
        if settings.code_alternate_row_color.eq_ignore_ascii_case("#FAFFFF") {
            settings.code_alternate_row_color.clear();
        }
    }
    Ok(settings)
}

#[cfg(test)]
mod theme_tests {
    use super::*;

    #[test]
    fn old_builtin_colours_migrate() {
        let settings = parse_settings("accent = '#39c5bb'\ncode_alternate_row_color = '#FAFFFF'").unwrap();
        assert_eq!(settings.accent, "#8A5CF5");
        assert!(settings.code_alternate_row_color.is_empty());
        assert_eq!(settings.color_scheme, "system");
        assert!(settings.confirm_delete);
    }

    #[test]
    fn custom_and_new_colours_survive_roundtrip() {
        for raw in [
            "accent = '#123456'\ncode_alternate_row_color = '#444444'",
            "accent = '#39C5BB'\ncolor_scheme = 'dark'\ncode_alternate_row_color = '#FAFFFF'",
        ] {
            let settings = parse_settings(raw).unwrap();
            let roundtrip = parse_settings(&toml::to_string(&settings).unwrap()).unwrap();
            assert_eq!(roundtrip.accent, settings.accent);
            assert_eq!(roundtrip.color_scheme, settings.color_scheme);
            assert_eq!(roundtrip.code_alternate_row_color, settings.code_alternate_row_color);
            assert!(raw.contains(&format!("'{}'", settings.accent)));
        }
    }

    #[test]
    fn invalid_file_is_backed_up_before_defaults_are_used() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store {
            path: dir.path().join("settings.toml"),
            portable: false,
            fallback: false,
        };
        let (_, issue) = store.load();
        assert!(issue.is_none(), "a missing file is a first run");

        let broken = "accent = '#123456'\nfont_size = \"large\n";
        std::fs::write(&store.path, broken).unwrap();
        let (settings, issue) = store.load();
        let issue = issue.expect("parse failure is reported");
        assert_eq!(settings.accent, Settings::default().accent);
        let backup = issue.backup.expect("original copied aside");
        assert_eq!(std::fs::read_to_string(backup).unwrap(), broken);

        store.save(&settings).unwrap();
        assert!(store.load().1.is_none());
    }

    #[test]
    fn absent_settings_use_new_defaults() {
        let settings = parse_settings("").unwrap();
        assert!(settings.markdown_only);
        assert!(!settings.windows_new_md);
        assert_eq!(settings.sidebar_width, 0.0);
        assert_eq!(settings.accent, "#8A5CF5");
        assert_eq!(settings.color_scheme, "system");
        assert!(settings.code_alternate_row_color.is_empty());
    }

    #[test]
    fn workspace_preferences_survive_roundtrip() {
        let settings = parse_settings("markdown_only = false\nsidebar_width = 350.0\nwindows_new_md = true").unwrap();
        let restored = parse_settings(&toml::to_string(&settings).unwrap()).unwrap();
        assert!(!restored.markdown_only);
        assert!(restored.windows_new_md);
        assert_eq!(restored.sidebar_width, 350.0);
    }
}
