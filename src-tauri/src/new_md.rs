//! Per-user Explorer ShellNew registration, separate from Open With/defaults.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct NewMdStatus {
    pub available: bool,
    pub enabled: bool,
    pub can_modify: bool,
    pub conflict: Option<String>,
}

#[cfg(windows)]
mod registry {
    use super::NewMdStatus;
    use serde::{Deserialize, Serialize};
    use std::{
        fs, io,
        path::Path,
        thread,
        time::{Duration, Instant},
    };
    use winreg::{enums::*, RegKey, RegValue};

    const STATE: &str = r"Software\PaperNest\NewMarkdownMenu";
    const SHELL_NEW: &str = r".md\ShellNew";
    const FALLBACK: &str = "PaperNest.NewMarkdown";
    // Bump the modifier when translations change: MUI otherwise caches old text.
    fn menu_resource(exe: &Path) -> String {
        format!("@{},-42001;v2", exe.display())
    }

    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct Value {
        bytes: Vec<u8>,
        expand: bool,
    }
    impl Value {
        fn from_raw(raw: RegValue) -> anyhow::Result<Self> {
            anyhow::ensure!(
                raw.vtype == REG_SZ || raw.vtype == REG_EXPAND_SZ,
                "Unsupported existing registry value"
            );
            Ok(Self {
                bytes: raw.bytes,
                expand: raw.vtype == REG_EXPAND_SZ,
            })
        }
        fn text(text: &str, expand: bool) -> Self {
            Self {
                bytes: text
                    .encode_utf16()
                    .chain(Some(0))
                    .flat_map(u16::to_le_bytes)
                    .collect(),
                expand,
            }
        }
        fn raw(&self) -> RegValue {
            RegValue {
                bytes: self.bytes.clone(),
                vtype: if self.expand { REG_EXPAND_SZ } else { REG_SZ },
            }
        }
        fn matches(&self, raw: &RegValue) -> bool {
            self.bytes == raw.bytes && raw.vtype == self.raw().vtype
        }
    }
    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct Write {
        path: String,
        name: String,
        before: Option<Value>,
        after: Value,
    }
    #[derive(Debug, Clone, Serialize, Deserialize)]
    struct Journal {
        owner: String,
        writes: Vec<Write>,
        created: Vec<String>,
    }

    // An exclusive per-user file handle also serializes different app processes.
    pub fn lock() -> anyhow::Result<fs::File> {
        use std::os::windows::fs::OpenOptionsExt;
        let base = crate::portable::local_data_base()
            .ok_or_else(|| anyhow::anyhow!("Cannot find local application data"))?
            .join("PaperNest");
        fs::create_dir_all(&base)?;
        let started = Instant::now();
        loop {
            match fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .share_mode(0)
                .open(base.join("new-md-menu.lock"))
            {
                Ok(file) => return Ok(file),
                Err(e)
                    if e.raw_os_error() == Some(32)
                        && started.elapsed() < Duration::from_secs(3) =>
                {
                    thread::sleep(Duration::from_millis(20))
                }
                Err(e) => return Err(e.into()),
            }
        }
    }

    fn raw(root: &RegKey, path: &str, name: &str) -> io::Result<Option<RegValue>> {
        match root
            .open_subkey(path)
            .and_then(|key| key.get_raw_value(name))
        {
            Ok(value) => Ok(Some(value)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }
    fn text(root: &RegKey, path: &str, name: &str) -> io::Result<Option<String>> {
        match root.open_subkey(path).and_then(|key| key.get_value(name)) {
            Ok(value) => Ok(Some(value)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }
    fn exists(root: &RegKey, path: &str) -> io::Result<bool> {
        match root.open_subkey(path) {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e),
        }
    }
    fn journal(state: &RegKey) -> anyhow::Result<Option<Journal>> {
        let saved: Option<Journal> = text(state, "", "Journal")?
            .map(|json| serde_json::from_str(&json))
            .transpose()?;
        if let Some(saved) = &saved {
            let paths = [
                ".md",
                SHELL_NEW,
                FALLBACK,
                r"PaperNest.NewMarkdown\shell",
                r"PaperNest.NewMarkdown\shell\open",
                r"PaperNest.NewMarkdown\shell\open\command",
            ];
            anyhow::ensure!(
                saved.writes.len() <= 6
                    && saved.created.len() <= 6
                    && saved.created.iter().all(|p| paths.contains(&p.as_str()))
                    && saved.writes.iter().all(|w| paths.contains(&w.path.as_str())
                        && ["", "MenuText", "ItemName", "NullFile"].contains(&w.name.as_str())),
                "Invalid New-menu ownership journal; no registration was changed"
            );
        }
        Ok(saved)
    }
    fn save_journal(state: &RegKey, journal: &Journal) -> anyhow::Result<()> {
        state.set_value("Journal", &serde_json::to_string(journal)?)?;
        Ok(())
    }
    fn owned_by(journal: &Journal, exe: &Path) -> bool {
        let owner = Path::new(&journal.owner);
        crate::portable::same_path(owner, exe)
            || !owner.exists()
            || owner
                .parent()
                .zip(exe.parent())
                .is_some_and(|(a, b)| crate::portable::same_path(a, b))
    }
    fn matches(classes: &RegKey, write: &Write) -> anyhow::Result<bool> {
        Ok(raw(classes, &write.path, &write.name)?.is_some_and(|v| write.after.matches(&v)))
    }
    fn foreign_shell_new(merged: &RegKey) -> anyhow::Result<bool> {
        if exists(merged, SHELL_NEW)? {
            return Ok(true);
        }
        if let Some(prog) = text(merged, ".md", "")? {
            if !prog.is_empty() && exists(merged, &format!(r".md\{prog}\ShellNew"))? {
                return Ok(true);
            }
        }
        if let Ok(md) = merged.open_subkey(".md") {
            for child in md.enum_keys() {
                if exists(&md, &format!(r"{}\ShellNew", child?))? {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }
    fn status_at(
        classes: &RegKey,
        merged: &RegKey,
        state: &RegKey,
        exe: &Path,
    ) -> anyhow::Result<NewMdStatus> {
        if let Some(saved) = journal(state)? {
            let enabled = saved
                .writes
                .iter()
                .find(|w| w.path == SHELL_NEW && w.name == "NullFile")
                .map(|w| matches(classes, w))
                .transpose()?
                .unwrap_or(false);
            let can_modify = owned_by(&saved, exe);
            let intact = saved
                .writes
                .iter()
                .map(|w| matches(classes, w))
                .collect::<anyhow::Result<Vec<_>>>()?
                .into_iter()
                .all(|v| v);
            return Ok(NewMdStatus {
                available: true,
                enabled,
                can_modify,
                conflict: if !can_modify {
                    Some("other_installation".into())
                } else if !intact {
                    Some("modified".into())
                } else {
                    None
                },
            });
        }
        let conflict = foreign_shell_new(merged)?;
        Ok(NewMdStatus {
            available: true,
            enabled: false,
            can_modify: !conflict,
            conflict: conflict.then(|| "existing".into()),
        })
    }
    fn write(
        classes: &RegKey,
        state: &RegKey,
        saved: &mut Journal,
        path: &str,
        name: &str,
        after: Value,
    ) -> anyhow::Result<()> {
        let before = raw(classes, path, name)?.map(Value::from_raw).transpose()?;
        let mut parent = String::new();
        for part in path.split('\\') {
            if !parent.is_empty() {
                parent.push('\\');
            }
            parent.push_str(part);
            if !exists(classes, &parent)? && !saved.created.contains(&parent) {
                saved.created.push(parent.clone());
            }
        }
        saved.writes.push(Write {
            path: path.into(),
            name: name.into(),
            before,
            after: after.clone(),
        });
        // Write-ahead journal makes interruption recoverable, including rollback.
        save_journal(state, saved)?;
        classes
            .create_subkey(path)?
            .0
            .set_raw_value(name, &after.raw())?;
        Ok(())
    }
    fn cleanup(classes: &RegKey, state: &RegKey, saved: &Journal) -> anyhow::Result<()> {
        for item in saved.writes.iter().rev() {
            if !matches(classes, item)? {
                continue;
            } // A later writer owns this value now.
            let key = classes.open_subkey_with_flags(&item.path, KEY_READ | KEY_WRITE)?;
            if let Some(before) = &item.before {
                key.set_raw_value(&item.name, &before.raw())?;
            } else {
                key.delete_value(&item.name)?;
            }
        }
        for path in saved.created.iter().rev() {
            if let Ok(key) = classes.open_subkey(path) {
                let info = key.query_info()?;
                if info.sub_keys == 0 && info.values == 0 {
                    drop(key);
                    classes.delete_subkey(path)?;
                }
            }
        }
        match state.delete_value("Journal") {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        Ok(())
    }
    fn set_at(
        classes: &RegKey,
        merged: &RegKey,
        state: &RegKey,
        exe: &Path,
        enabled: bool,
    ) -> anyhow::Result<NewMdStatus> {
        if let Some(saved) = journal(state)? {
            anyhow::ensure!(
                owned_by(&saved, exe),
                "The menu is managed by another PaperNest installation. Change it there."
            );
            if enabled
                && saved
                    .writes
                    .iter()
                    .all(|w| matches(classes, w).unwrap_or(false))
                && crate::portable::same_path(Path::new(&saved.owner), exe)
                && saved.writes.iter().any(|w| {
                    w.name == "MenuText"
                        && w.after
                            .matches(&Value::text(&menu_resource(exe), true).raw())
                })
            {
                return status_at(classes, merged, state, exe);
            }
            cleanup(classes, state, &saved)?;
        }
        if !enabled {
            return status_at(classes, merged, state, exe);
        }
        anyhow::ensure!(!foreign_shell_new(merged)?, "An existing MD New-menu entry is registered by another application. It was left unchanged.");
        let default = text(merged, ".md", "")?.filter(|s| !s.trim().is_empty());
        if let Some(prog) = &default {
            anyhow::ensure!(text(merged,&format!(r"{prog}\shell\open\command"),"")?.is_some_and(|s| !s.trim().is_empty()), "The existing MD file type has no open command. Set a default MD application in Windows first.");
        } else {
            anyhow::ensure!(!exists(merged,FALLBACK)?, "The fallback Markdown file type already exists. No existing registration was replaced.");
        }
        let mut saved = Journal {
            owner: exe.to_string_lossy().into_owned(),
            writes: vec![],
            created: vec![],
        };
        let result = (|| -> anyhow::Result<()> {
            if default.is_none() {
                write(
                    classes,
                    state,
                    &mut saved,
                    FALLBACK,
                    "",
                    Value::text("MD File", false),
                )?;
                write(
                    classes,
                    state,
                    &mut saved,
                    &format!(r"{FALLBACK}\shell\open\command"),
                    "",
                    Value::text(&format!("\"{}\" \"%1\"", exe.display()), false),
                )?;
                write(
                    classes,
                    state,
                    &mut saved,
                    ".md",
                    "",
                    Value::text(FALLBACK, false),
                )?;
            }
            let resource = menu_resource(exe);
            write(
                classes,
                state,
                &mut saved,
                SHELL_NEW,
                "MenuText",
                Value::text(&resource, true),
            )?;
            write(
                classes,
                state,
                &mut saved,
                SHELL_NEW,
                "ItemName",
                Value::text(&resource, true),
            )?;
            write(
                classes,
                state,
                &mut saved,
                SHELL_NEW,
                "NullFile",
                Value::text("", false),
            )?;
            anyhow::ensure!(
                saved
                    .writes
                    .iter()
                    .all(|w| matches(classes, w).unwrap_or(false)),
                "Could not verify the New-menu registration"
            );
            Ok(())
        })();
        if let Err(error) = result {
            if let Err(rollback) = cleanup(classes, state, &saved) {
                return Err(anyhow::anyhow!("{error}; rollback failed: {rollback}"));
            }
            return Err(error);
        }
        status_at(classes, merged, state, exe)
    }
    fn roots() -> anyhow::Result<(RegKey, RegKey, RegKey)> {
        let user = RegKey::predef(HKEY_CURRENT_USER);
        Ok((
            user.create_subkey(r"Software\Classes")?.0,
            RegKey::predef(HKEY_CLASSES_ROOT),
            user.create_subkey(STATE)?.0,
        ))
    }
    pub fn read() -> anyhow::Result<NewMdStatus> {
        let (classes, merged, state) = roots()?;
        status_at(&classes, &merged, &state, &std::env::current_exe()?)
    }
    // Caller holds the per-user lock across registry mutation and settings save.
    pub fn set(enabled: bool) -> anyhow::Result<NewMdStatus> {
        let (classes, merged, state) = roots()?;
        let result = set_at(
            &classes,
            &merged,
            &state,
            &std::env::current_exe()?,
            enabled,
        );
        unsafe {
            windows_sys::Win32::UI::Shell::SHChangeNotify(
                0x08000000,
                0,
                std::ptr::null(),
                std::ptr::null(),
            );
        }
        result
    }
    pub fn uninstall() -> anyhow::Result<()> {
        let _lock = lock()?;
        let (classes, _, state) = roots()?;
        if let Some(saved) = journal(&state)? {
            if crate::portable::same_path(Path::new(&saved.owner), &std::env::current_exe()?) {
                cleanup(&classes, &state, &saved)?;
                unsafe {
                    windows_sys::Win32::UI::Shell::SHChangeNotify(
                        0x08000000,
                        0,
                        std::ptr::null(),
                        std::ptr::null(),
                    );
                }
            }
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn registration_preserves_defaults_and_other_writers() {
            let parent = RegKey::predef(HKEY_CURRENT_USER);
            let path = format!(
                r"Software\PaperNest\Tests\NewMd-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            );
            let root = parent.create_subkey(&path).unwrap().0;
            let classes = root.create_subkey("Classes").unwrap().0;
            let state = root.create_subkey("State").unwrap().0;
            let exe = std::env::current_exe().unwrap();
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                classes
                    .create_subkey(".md")
                    .unwrap()
                    .0
                    .set_value("", &"Other.MD")
                    .unwrap();
                classes
                    .create_subkey(r"Other.MD\shell\open\command")
                    .unwrap()
                    .0
                    .set_value("", &"other.exe %1")
                    .unwrap();
                assert!(!status_at(&classes, &classes, &state, &exe).unwrap().enabled);
                assert!(
                    set_at(&classes, &classes, &state, &exe, true)
                        .unwrap()
                        .enabled
                );
                assert_eq!(
                    text(&classes, ".md", "").unwrap().as_deref(),
                    Some("Other.MD")
                );
                assert!(
                    set_at(&classes, &classes, &state, &exe, true)
                        .unwrap()
                        .enabled
                );
                classes
                    .open_subkey_with_flags(SHELL_NEW, KEY_WRITE)
                    .unwrap()
                    .set_value("MenuText", &"third party")
                    .unwrap();
                assert!(
                    !set_at(&classes, &classes, &state, &exe, false)
                        .unwrap()
                        .enabled
                );
                assert_eq!(
                    text(&classes, SHELL_NEW, "MenuText").unwrap().as_deref(),
                    Some("third party")
                );
                assert!(set_at(&classes, &classes, &state, &exe, true).is_err());
                assert!(exists(&classes, SHELL_NEW).unwrap());
                classes
                    .open_subkey_with_flags(SHELL_NEW, KEY_WRITE)
                    .unwrap()
                    .delete_value("MenuText")
                    .unwrap();
                classes.delete_subkey(SHELL_NEW).unwrap();
                classes
                    .open_subkey_with_flags(".md", KEY_WRITE)
                    .unwrap()
                    .delete_value("")
                    .unwrap();
                assert!(
                    set_at(&classes, &classes, &state, &exe, true)
                        .unwrap()
                        .enabled
                );
                assert_eq!(
                    text(&classes, ".md", "").unwrap().as_deref(),
                    Some(FALLBACK)
                );
                assert!(
                    !set_at(&classes, &classes, &state, &exe, false)
                        .unwrap()
                        .enabled
                );
                assert!(text(&classes, ".md", "").unwrap().is_none());
                assert!(!exists(&classes, FALLBACK).unwrap());

                // Recover an interruption between journaling and applying a value.
                classes
                    .open_subkey_with_flags(".md", KEY_WRITE)
                    .unwrap()
                    .set_value("", &"Other.MD")
                    .unwrap();
                let mut partial = Journal {
                    owner: exe.to_string_lossy().into_owned(),
                    writes: vec![],
                    created: vec![],
                };
                write(
                    &classes,
                    &state,
                    &mut partial,
                    SHELL_NEW,
                    "MenuText",
                    Value::text("partial", false),
                )
                .unwrap();
                partial.writes.push(Write {
                    path: SHELL_NEW.into(),
                    name: "NullFile".into(),
                    before: None,
                    after: Value::text("", false),
                });
                save_journal(&state, &partial).unwrap();
                cleanup(&classes, &state, &journal(&state).unwrap().unwrap()).unwrap();
                assert!(journal(&state).unwrap().is_none());
                assert!(!exists(&classes, SHELL_NEW).unwrap());
                assert_eq!(
                    text(&classes, ".md", "").unwrap().as_deref(),
                    Some("Other.MD")
                );

                // Incomplete foreign types are never silently replaced.
                classes
                    .open_subkey_with_flags(".md", KEY_WRITE)
                    .unwrap()
                    .set_value("", &"Missing.Type")
                    .unwrap();
                assert!(set_at(&classes, &classes, &state, &exe, true).is_err());
                assert_eq!(
                    text(&classes, ".md", "").unwrap().as_deref(),
                    Some("Missing.Type")
                );
                state
                    .set_value(
                        "Journal",
                        &r#"{"owner":"other","writes":[],"created":["Unrelated"]}"#,
                    )
                    .unwrap();
                assert!(journal(&state).is_err());
                state.delete_value("Journal").unwrap();
            }));
            drop(classes);
            drop(state);
            drop(root);
            parent.delete_subkey_all(path).unwrap();
            if let Err(panic) = result {
                std::panic::resume_unwind(panic);
            }
        }
    }
}

pub fn status() -> Result<NewMdStatus, String> {
    with_status(|status| status)
}

// Keep the registry lock until an ordinary settings save finishes too: another
// window may toggle the menu between reading its status and saving preferences.
pub(crate) fn with_status<T>(operation: impl FnOnce(Result<NewMdStatus, String>) -> T) -> T {
    #[cfg(windows)]
    {
        let guard = registry::lock();
        let status = match &guard {
            Ok(_) => registry::read().map_err(|e| e.to_string()),
            Err(error) => Err(error.to_string()),
        };
        operation(status)
    }
    #[cfg(not(windows))]
    {
        operation(Ok(NewMdStatus {
            available: false,
            enabled: false,
            can_modify: false,
            conflict: None,
        }))
    }
}
#[cfg(windows)]
pub use registry::uninstall;

#[tauri::command]
pub async fn get_new_md_menu_status() -> Result<NewMdStatus, String> {
    tauri::async_runtime::spawn_blocking(status)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_new_md_menu(enabled: bool, app: tauri::AppHandle) -> Result<NewMdStatus, String> {
    #[cfg(windows)]
    use tauri::{Emitter, Manager};
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            let _lock = registry::lock().map_err(|e| e.to_string())?;
            let state = app.state::<crate::AppState>();
            let store = state.store.lock().unwrap();
            let (mut settings, issue) = store.load();
            if issue.is_some() {
                return Err(
                    "Repair the invalid settings file before changing system integration.".into(),
                );
            }
            // This command saves the whole Settings struct, session fields
            // included. Re-apply the user-wide reading session first so a
            // preference change cannot push a stale session into settings.toml
            // and make that file look newer than the shared record.
            crate::reading_session::load(&store.path, &mut settings);
            let previous = registry::read().map_err(|e| e.to_string())?.enabled;
            let status = registry::set(enabled).map_err(|e| e.to_string())?;
            settings.windows_new_md = status.enabled;
            match store.save(&settings) {
                Ok(sig) => *state.last_write.lock().unwrap() = Some(sig),
                Err(error) => {
                    let rollback = registry::set(previous);
                    return Err(format!(
                        "Could not save settings: {error}; registry rollback: {}",
                        rollback
                            .err()
                            .map(|e| e.to_string())
                            .unwrap_or_else(|| "complete".into())
                    ));
                }
            }
            let _ = app.emit("new-md-menu-changed", &status);
            Ok(status)
        }
        #[cfg(not(windows))]
        {
            let _ = (enabled, app);
            Err("Windows Explorer integration is only available on Windows.".into())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
