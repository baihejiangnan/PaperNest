mod assets;
mod commands;
mod delete_info;
mod export;
mod fs_util;
mod file_open;
mod mdfmt;
mod new_md;
mod portable;
mod proxy;
mod recycle;
mod settings;
mod reading_session;
mod update;
mod workspace;
mod windows_integration;
#[cfg(target_os = "windows")]
mod windows_launch;

use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::Manager;

use settings::{LastWrite, Store};

pub struct AppState {
    pub store: Mutex<Store>,
    /// Signature of the file the app itself last wrote — lets the watcher ignore
    /// our own saves and only react to external hand edits.
    pub last_write: LastWrite,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    if let Some(result) = windows_integration::installer_cli_action() {
        if let Err(err) = result {
            eprintln!("PaperNest installer integration failed: {err:#}");
            std::process::exit(1);
        }
        return;
    }

    // Installer actions above need their original privileges. The reader must
    // hand off before opening settings, WebView2 or the single-instance mutex.
    #[cfg(target_os = "windows")]
    match windows_launch::handoff_installer_launch() {
        Ok(true) => return,
        Ok(false) => {},
        Err(err) => {
            windows_launch::show_launch_error(&err);
            return;
        }
    }

    #[cfg(target_os = "windows")]
    if let Err(err) = windows_integration::maintain_portable_registration() {
        eprintln!("PaperNest portable registration maintenance failed: {err:#}");
    }

    let store = Store::locate();

    let mut context = tauri::generate_context!();

    // Select the main profile before WebView2 starts. Drop the startup override
    // in setup so later windows honor their own data directories.
    #[cfg(target_os = "windows")]
    {
        let data = if store.portable {
            portable::portable_dir().map(|dir| dir.join("data").join("webview2"))
        } else {
            portable::local_data_base().map(|dir| dir.join("PaperNest").join("webview2"))
        };
        if let Some(data) = data {
            if std::fs::create_dir_all(&data).is_ok() {
                std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &data);
                if let Some(main) = context.config_mut().app.windows.iter_mut().find(|w| w.label == "main") {
                    main.data_directory = Some(data);
                }
            }
        }
    }

    let settings_path = store.path.clone();
    let last_write: LastWrite = Arc::new(Mutex::new(None));
    let watcher_last_write = last_write.clone();
    let pending_files = file_open::PendingFiles::default();
    pending_files.push(file_open::files_from_args(
        &std::env::args().collect::<Vec<_>>(), &std::env::current_dir().unwrap_or_default(),
    ));

    tauri::Builder::default()
        // single-instance must be registered first
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let paths = file_open::files_from_args(&argv, Path::new(&cwd));
            file_open::enqueue(app, paths);
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pending_files)
        .manage(AppState {
            store: Mutex::new(store),
            last_write,
        })
        .setup(move |app| {
            #[cfg(target_os = "windows")]
            std::env::remove_var("WEBVIEW2_USER_DATA_FOLDER");
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                settings::watch(settings_path, watcher_last_write, handle)
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            file_open::take_pending_files,
            commands::get_settings,
            commands::save_settings,
            commands::get_open_with_status,
            commands::register_open_with,
            commands::register_file_associations,
            commands::unregister_open_with,
            new_md::get_new_md_menu_status,
            new_md::set_new_md_menu,
            commands::read_document,
            commands::write_document,
            commands::rename_document,
            workspace::list_workspace_dir,
            workspace::search_workspace,
            workspace::resolve_workspace_link,
            workspace::create_workspace_entry,
            workspace::duplicate_workspace_file,
            workspace::rename_workspace_entry,
            workspace::delete_workspace_entry,
            delete_info::get_workspace_delete_info,
            workspace::open_workspace_location,
            workspace::open_workspace_window,
            commands::render_html,
            commands::read_image_data_url,
            proxy::test_proxy,
            proxy::fetch_remote_image_data_url,
            update::check_for_update,
            update::prepare_new_version,
            update::use_prepared_version,
            update::show_prepared_version,
        ])
        .build(context)
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                file_open::enqueue(_app, file_open::local_files(urls));
            }
        });
}
