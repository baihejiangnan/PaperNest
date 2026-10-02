//! System recycling only: failure must never fall back to permanent deletion.
use std::path::Path;

pub(crate) fn move_to_trash(path: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Could not move {} to the recycle bin: {e}", path.display()))?;
    if !metadata.is_file() && !metadata.is_dir() && !metadata.is_symlink() {
        return Err("Only files and folders can be moved to the recycle bin.".into());
    }
    // Resolve only the parent, preserving symlinks instead of recycling their
    // targets, and give the Shell an absolute path with normalized parents.
    let absolute = std::path::absolute(path).map_err(|e| e.to_string())?;
    let name = absolute
        .file_name()
        .ok_or("Cannot recycle a filesystem root.")?;
    let parent = absolute
        .parent()
        .ok_or("Cannot recycle a filesystem root.")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let target = parent.join(name);
    recycle(&target).map_err(|e| {
        format!(
            "Could not move {} to the recycle bin. The item was not permanently deleted: {e}",
            path.display()
        )
    })
}

#[cfg(not(windows))]
fn recycle(path: &Path) -> Result<(), String> {
    trash::delete(path).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn recycle(path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::{System::Com::*, UI::Shell::*},
    };

    let raw = path.as_os_str().to_string_lossy();
    let shell_path = if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_owned()
    };
    // Windows network shares have no local system recycle bin.
    if shell_path.starts_with(r"\\") {
        return Err("This location does not support the system recycle bin.".into());
    }
    let wide: Vec<u16> = std::ffi::OsStr::new(&shell_path)
        .encode_wide()
        .chain(Some(0))
        .collect();
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        let _apartment = Apartment;
        let result = (|| -> windows::core::Result<()> {
            let operation: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)?;
            // Suppress native feedback, request recycling, and stop on failure.
            // The sink below also vetoes the Shell's permanent-delete fallback.
            operation.SetOperationFlags(
                FOF_NO_UI | FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE | FOFX_EARLYFAILURE,
            )?;
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)?;
            let guard: IFileOperationProgressSink = windows_guard::RecycleOnly.into();
            operation.DeleteItem(&item, &guard)?;
            operation.PerformOperations()?;
            if operation.GetAnyOperationsAborted()?.as_bool() {
                return Err(windows::core::Error::new(
                    windows::Win32::Foundation::E_ABORT,
                    "Recycling was cancelled or unavailable.",
                ));
            }
            Ok(())
        })();
        result.map_err(|e| e.to_string())
    }
}

#[cfg(windows)]
mod windows_guard {
    use windows::Win32::UI::Shell::*;

    // Reject the Shell's permanent-deletion path before any item is removed.
    #[windows_core::implement(IFileOperationProgressSink)]
    pub(super) struct RecycleOnly;

    #[allow(non_snake_case)]
    impl IFileOperationProgressSink_Impl for RecycleOnly_Impl {
        fn StartOperations(&self) -> windows_core::Result<()> {
            Ok(())
        }
        fn FinishOperations(&self, _hrresult: windows_core::HRESULT) -> windows_core::Result<()> {
            _hrresult.ok()
        }
        fn PreRenameItem(
            &self,
            _dwflags: u32,
            _psiitem: windows_core::Ref<IShellItem>,
            _psznewname: &windows_core::PCWSTR,
        ) -> windows_core::Result<()> {
            Ok(())
        }
        fn PostRenameItem(
            &self,
            _dwflags: u32,
            _psiitem: windows_core::Ref<IShellItem>,
            _psznewname: &windows_core::PCWSTR,
            _hrrename: windows_core::HRESULT,
            _psinewlycreated: windows_core::Ref<IShellItem>,
        ) -> windows_core::Result<()> {
            Ok(())
        }
        fn PreMoveItem(
            &self,
            _dwflags: u32,
            _psiitem: windows_core::Ref<IShellItem>,
            _psidestinationfolder: windows_core::Ref<IShellItem>,
            _psznewname: &windows_core::PCWSTR,
        ) -> windows_core::Result<()> {
            Ok(())
        }
        fn PostMoveItem(
            &self,
            _dwflags: u32,
            _psiitem: windows_core::Ref<IShellItem>,
            _psidestinationfolder: windows_core::Ref<IShellItem>,
            _psznewname: &windows_core::PCWSTR,
            _hrmove: windows_core::HRESULT,
            _psinewlycreated: windows_core::Ref<IShellItem>,
        ) -> windows_core::Result<()> {
            Ok(())
        }
        fn PreCopyItem(
            &self,
            _dwflags: u32,
            _psiitem: windows_core::Ref<IShellItem>,
            _psidestinationfolder: windows_core::Ref<IShellItem>,
            _psznewname: &windows_core::PCWSTR,
        ) -> windows_core::Result<()> {
            Ok(())
        }
        fn PostCopyItem(
            &self,
            _dwflags: u32,
            _psiitem: windows_core::Ref<IShellItem>,
            _psidestinationfolder: windows_core::Ref<IShellItem>,
            _psznewname: &windows_core::PCWSTR,
            _hrcopy: windows_core::HRESULT,
            _psinewlycreated: windows_core::Ref<IShellItem>,
        ) -> windows_core::Result<()> {
            Ok(())
        }
        fn PreDeleteItem(
            &self,
            _dwflags: u32,
            _psiitem: windows_core::Ref<IShellItem>,
        ) -> windows_core::Result<()> {
            if _dwflags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 == 0 {
                return Err(windows_core::Error::new(
                    windows::Win32::Foundation::E_ABORT,
                    "The system would permanently delete this item; recycling was cancelled.",
                ));
            }
            Ok(())
        }
        fn PostDeleteItem(
            &self,
            _dwflags: u32,
            _psiitem: windows_core::Ref<IShellItem>,
            _hrdelete: windows_core::HRESULT,
            _psinewlycreated: windows_core::Ref<IShellItem>,
        ) -> windows_core::Result<()> {
            _hrdelete.ok()
        }
        fn PreNewItem(
            &self,
            _dwflags: u32,
            _psidestinationfolder: windows_core::Ref<IShellItem>,
            _psznewname: &windows_core::PCWSTR,
        ) -> windows_core::Result<()> {
            Ok(())
        }
        fn PostNewItem(
            &self,
            _dwflags: u32,
            _psidestinationfolder: windows_core::Ref<IShellItem>,
            _psznewname: &windows_core::PCWSTR,
            _psztemplatename: &windows_core::PCWSTR,
            _dwfileattributes: u32,
            _hrnew: windows_core::HRESULT,
            _psinewitem: windows_core::Ref<IShellItem>,
        ) -> windows_core::Result<()> {
            Ok(())
        }
        fn UpdateProgress(&self, _iworktotal: u32, _iworksofar: u32) -> windows_core::Result<()> {
            Ok(())
        }
        fn ResetTimer(&self) -> windows_core::Result<()> {
            Ok(())
        }
        fn PauseTimer(&self) -> windows_core::Result<()> {
            Ok(())
        }
        fn ResumeTimer(&self) -> windows_core::Result<()> {
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_item_returns_error() {
        let path = std::env::temp_dir().join(format!("papernest-missing-{}", std::process::id()));
        assert!(!path.exists());
        assert!(move_to_trash(&path).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn shell_permanent_delete_intent_is_vetoed() {
        use windows::Win32::UI::Shell::IFileOperationProgressSink;
        let guard: IFileOperationProgressSink = windows_guard::RecycleOnly.into();
        // 0x202 was observed when recycling failed on a restricted directory.
        for flags in [0, 0x202] {
            let error = unsafe { guard.PreDeleteItem(flags, None) }.unwrap_err();
            assert_eq!(error.code(), windows::Win32::Foundation::E_ABORT);
        }
    }

    /// Explicit opt-in: affects only unique test-created files, verifies actual
    /// recycle-bin membership, then restores them. Never empties the recycle bin.
    #[cfg(windows)]
    #[test]
    #[ignore = "requires the Windows system recycle bin; run explicitly"]
    fn windows_recycles_and_restores_files_and_folders() {
        let root = std::env::var_os("PAPERNEST_TEST_RECYCLE_ROOT")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let base = root.join(format!(
            "papernest-recycle-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&base).unwrap();
        let file = base.join("回收 文件.md");
        let folder = base.join("回收 文件夹");
        std::fs::write(&file, "recyclable file").unwrap();
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("child.md"), "recyclable child").unwrap();
        for target in [&file, &folder] {
            move_to_trash(target).unwrap();
        }
        assert!(!file.exists() && !folder.exists());
        let listed = trash::os_limited::list().unwrap();
        let items: Vec<_> = listed
            .into_iter()
            .filter(|item| item.original_path() == file || item.original_path() == folder)
            .collect();
        assert_eq!(
            items.len(),
            2,
            "Both targets must exist in the system recycle bin"
        );
        trash::os_limited::restore_all(items).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "recyclable file");
        assert_eq!(
            std::fs::read_to_string(folder.join("child.md")).unwrap(),
            "recyclable child"
        );
        std::fs::remove_dir_all(&base).unwrap();
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires the Windows system recycle bin; run explicitly"]
    fn windows_recycle_failure_preserves_locked_file() {
        use std::os::windows::fs::OpenOptionsExt;
        let path = std::env::temp_dir().join(format!(
            "papernest-locked-{}-{}.md",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let handle = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(move_to_trash(&path).is_err());
        assert!(
            path.exists(),
            "A recycle error must preserve the original file"
        );
        drop(handle);
        std::fs::remove_file(path).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn windows_network_locations_are_rejected() {
        // The Shell is never called for either UNC spelling. This check needs
        // no network share or credentials and cannot delete a network item.
        for path in [r"\\localhost\share\test.md", r"\\?\UNC\localhost\share\test.md"] {
            let error = super::recycle(std::path::Path::new(path)).unwrap_err();
            assert!(error.contains("does not support the system recycle bin"));
        }
    }
}
