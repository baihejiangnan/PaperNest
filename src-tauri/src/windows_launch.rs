//! Keep automatically launched readers at the desktop user's privilege level.
//! An elevated reader cannot receive normal Explorer's single-instance messages.
use std::{ffi::OsString, os::windows::ffi::OsStrExt, path::Path};
use windows::{
    core::{w, Interface, BSTR},
    Win32::{
        Foundation::{CloseHandle, HANDLE},
        Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, IDispatch, IServiceProvider,
                CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
            },
            Threading::{GetCurrentProcess, OpenProcessToken},
            Variant::VARIANT,
        },
        UI::{
            Shell::{
                IShellBrowser, IShellDispatch2, IShellFolderViewDual, IShellWindows,
                SID_STopLevelBrowser, ShellWindows, SVGIO_BACKGROUND, SWC_DESKTOP,
                SWFO_NEEDDISPATCH,
            },
            WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK},
        },
    },
};

const INSTALLER_LAUNCH: &str = "--papernest-installer-launch";
const DESKTOP_LAUNCH: &str = "--papernest-desktop-launch";
const RESUME_AFTER_UPDATE: &str = "--papernest-resume-after-update";

fn installer_arguments(args: impl Iterator<Item = OsString>) -> Option<Vec<OsString>> {
    let mut requested = false;
    let mut from_desktop = false;
    let mut remaining: Vec<OsString> = args
        .filter(|arg| {
            if arg == INSTALLER_LAUNCH {
                requested = true;
                false
            } else if arg == DESKTOP_LAUNCH {
                from_desktop = true;
                false
            } else {
                // Older update helpers only pass the resume flag.
                requested |= arg == RESUME_AFTER_UPDATE;
                true
            }
        })
        .collect();
    if !requested || from_desktop {
        return None;
    }
    remaining.push(OsString::from(DESKTOP_LAUNCH));
    Some(remaining)
}

fn is_elevated() -> windows::core::Result<bool> {
    struct Token(HANDLE);
    impl Drop for Token {
        fn drop(&mut self) {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
    unsafe {
        let mut token = Token(HANDLE::default());
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token.0)?;
        let mut elevation = TOKEN_ELEVATION::default();
        let mut size = 0;
        GetTokenInformation(
            token.0,
            TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        )?;
        Ok(elevation.TokenIsElevated != 0)
    }
}

// Windows argv quoting, not PowerShell/cmd syntax. Preserve spaces, empty args,
// quotes and trailing backslashes without running any argument as shell code.
fn quote_arguments(args: &[OsString]) -> BSTR {
    let mut result = Vec::new();
    for (index, arg) in args.iter().enumerate() {
        if index > 0 {
            result.push(b' ' as u16);
        }
        result.push(b'"' as u16);
        let mut backslashes = 0;
        for ch in arg.encode_wide() {
            if ch == b'\\' as u16 {
                backslashes += 1;
                continue;
            }
            let count = if ch == b'"' as u16 {
                backslashes * 2 + 1
            } else {
                backslashes
            };
            result.extend(std::iter::repeat_n(b'\\' as u16, count));
            backslashes = 0;
            result.push(ch);
        }
        result.extend(std::iter::repeat_n(b'\\' as u16, backslashes * 2));
        result.push(b'"' as u16);
    }
    BSTR::from_wide(&result)
}

// Use the desktop's Shell.Application, not a newly created Shell.Application
// in this elevated process. See Microsoft's ExecInExplorer sample.
fn execute_in_explorer(
    executable: &Path,
    args: &[OsString],
    directory: &Path,
) -> windows::core::Result<()> {
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let _apartment = Apartment;
        let shell: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_LOCAL_SERVER)?;
        let empty = VARIANT::default();
        let mut hwnd = 0;
        let desktop =
            shell.FindWindowSW(&empty, &empty, SWC_DESKTOP, &mut hwnd, SWFO_NEEDDISPATCH)?;
        let services: IServiceProvider = desktop.cast()?;
        let browser: IShellBrowser = services.QueryService(&SID_STopLevelBrowser)?;
        let view = browser.QueryActiveShellView()?;
        let background: IDispatch = view.GetItemObject(SVGIO_BACKGROUND)?;
        let folder: IShellFolderViewDual = background.cast()?;
        let dispatch: IShellDispatch2 = folder.Application()?.cast()?;
        dispatch.ShellExecute(
            &BSTR::from_wide(&executable.as_os_str().encode_wide().collect::<Vec<_>>()),
            &VARIANT::from(quote_arguments(args)),
            &VARIANT::from(BSTR::from_wide(
                &directory.as_os_str().encode_wide().collect::<Vec<_>>(),
            )),
            &VARIANT::from("open"),
            &VARIANT::from(1i32),
        )
    }
}

/// True means Explorer has accepted the launch and this process must exit.
/// The child carries a guard so even an elevated desktop cannot loop.
pub(crate) fn handoff_installer_launch() -> anyhow::Result<bool> {
    let Some(args) = installer_arguments(std::env::args_os().skip(1)) else {
        return Ok(false);
    };
    if !is_elevated()? {
        return Ok(false);
    }
    let exe = std::env::current_exe()?;
    execute_in_explorer(&exe, &args, &std::env::current_dir()?)?;
    Ok(true)
}

pub(crate) fn show_launch_error(error: &anyhow::Error) {
    eprintln!("PaperNest normal-user launch failed: {error:#}");
    unsafe {
        MessageBoxW(None, w!("PaperNest could not restart through Windows Explorer. Open PaperNest from the Start menu or its shortcut."),
            w!("PaperNest"), MB_OK | MB_ICONERROR);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;

    #[test]
    fn installer_marker_is_removed_without_losing_recovery_or_file_args() {
        let values = [
            INSTALLER_LAUNCH,
            "--papernest-resume-after-update",
            "--papernest-update-failed",
            "C:\\a b\\中文.md",
            INSTALLER_LAUNCH,
        ];
        let args = installer_arguments(values.into_iter().map(OsString::from)).unwrap();
        let mut expected = values[1..4].iter().map(OsString::from).collect::<Vec<_>>();
        expected.push(OsString::from(DESKTOP_LAUNCH));
        assert_eq!(args, expected);
        assert!(installer_arguments([OsString::from("normal.md")].into_iter()).is_none());
        assert_eq!(
            installer_arguments([OsString::from(INSTALLER_LAUNCH)].into_iter()),
            Some(vec![OsString::from(DESKTOP_LAUNCH)])
        );
        let legacy =
            installer_arguments([OsString::from(RESUME_AFTER_UPDATE)].into_iter()).unwrap();
        assert_eq!(
            legacy,
            vec![
                OsString::from(RESUME_AFTER_UPDATE),
                OsString::from(DESKTOP_LAUNCH)
            ]
        );
        assert!(
            installer_arguments(legacy.into_iter()).is_none(),
            "Explorer child must not relaunch again"
        );
    }

    #[test]
    fn quoting_round_trips_windows_command_line() {
        use windows::Win32::{
            Foundation::{LocalFree, HLOCAL},
            UI::Shell::CommandLineToArgvW,
        };
        let args: Vec<OsString> = [
            "",
            "simple",
            "中文 路径.md",
            "a\tb",
            "a\"b",
            "C:\\folder with space\\",
            "\\\\server\\a.md",
            "$(touch x); & echo %USERPROFILE%",
            "\\\\\"tail\\",
        ]
        .into_iter()
        .map(OsString::from)
        .collect();
        let command = format!("probe.exe {}", quote_arguments(&args));
        let wide: Vec<u16> = OsStr::new(&command).encode_wide().chain(Some(0)).collect();
        unsafe {
            let mut count = 0;
            let parsed = CommandLineToArgvW(windows::core::PCWSTR(wide.as_ptr()), &mut count);
            assert!(!parsed.is_null());
            let actual: Vec<OsString> = std::slice::from_raw_parts(parsed, count as usize)
                .iter()
                .skip(1)
                .map(|arg| OsString::from(String::from_utf16_lossy(arg.as_wide())))
                .collect();
            LocalFree(Some(HLOCAL(parsed.cast())));
            assert_eq!(actual, args);
        }
    }

    #[test]
    #[ignore = "child process used by explorer_handoff_runs_as_desktop_user"]
    fn explorer_probe() {
        let output = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .join("probe.json");
        let result = serde_json::json!({"elevated": is_elevated().unwrap(), "args": std::env::args().collect::<Vec<_>>()});
        std::fs::write(output, result.to_string()).unwrap();
    }

    #[test]
    #[ignore = "requires an interactive Explorer desktop; launches an isolated test executable"]
    fn explorer_handoff_runs_as_desktop_user() {
        let folder = tempfile::tempdir().unwrap();
        let exe = folder.path().join("launch probe.exe");
        std::fs::copy(std::env::current_exe().unwrap(), &exe).unwrap();
        let args: Vec<OsString> = [
            "--ignored",
            "--exact",
            "windows_launch::tests::explorer_probe",
            "--skip",
            r#"中文 "quoted" end\"#,
            "--nocapture",
        ]
        .into_iter()
        .map(OsString::from)
        .collect();
        execute_in_explorer(&exe, &args, folder.path()).unwrap();
        let output = folder.path().join("probe.json");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while !output.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let result: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(output).expect("Explorer launched the probe"),
        )
        .unwrap();
        assert_eq!(
            result["elevated"], false,
            "child must use the normal desktop token"
        );
        assert_eq!(
            result["args"]
                .as_array()
                .unwrap()
                .iter()
                .skip(1)
                .map(|v| v.as_str().unwrap())
                .collect::<Vec<_>>(),
            args.iter().map(|v| v.to_str().unwrap()).collect::<Vec<_>>()
        );
    }
}
