mod commands;

use std::sync::Mutex;
use tauri::Emitter;
use tauri::Manager;

fn is_markdown(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".md") || lower.ends_with(".mdx") || lower.ends_with(".markdown")
}

fn open_markdown_path(app: &tauri::AppHandle, path: String) {
    {
        let state = app.state::<commands::InitialFileState>();
        *state.path.lock().unwrap() = Some(path.clone());
    }

    let _ = app.emit("file-association-open", path);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(target_os = "macos")]
fn handle_macos_opened_urls(app: &tauri::AppHandle, urls: Vec<tauri::Url>) {
    for url in urls {
        let Ok(path) = url.to_file_path() else {
            continue;
        };
        let path = path.to_string_lossy().to_string();
        if is_markdown(&path) {
            open_markdown_path(app, path);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(commands::WatcherState {
            watcher: Mutex::new(None),
        });

    // tauri_plugin_single_instance uses zbus to register a well-known DBus
    // name derived from the app identifier. Under Snap strict confinement
    // the app can only own names matching the snap ID, so registration
    // panics. Snap already enforces single-instance via its own namespace,
    // so skip the plugin when running inside a snap.
    if std::env::var("SNAP").is_err() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Windows and Linux commonly pass the file path as an argv entry.
            if let Some(path) = argv.iter().skip(1).find(|a| is_markdown(a)) {
                open_markdown_path(app, path.clone());
            }
        }));
    }

    builder
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::InitialFileState {
            path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_file,
            commands::write_file,
            commands::file_exists,
            commands::path_exists,
            commands::open_local_path,
            commands::find_path_by_name,
            commands::save_markdown_dialog,
            commands::open_file_dialog,
            commands::watch_file,
            commands::unwatch_file,
            commands::open_default_apps_settings,
            commands::get_initial_file
        ])
        .setup(|app| {
            // First-instance launches on Windows/Linux often carry the file in argv.
            // macOS Finder launches are delivered later through RunEvent::Opened.
            let args: Vec<String> = std::env::args().collect();
            if args.len() > 1 {
                let path = &args[1];
                if is_markdown(path) {
                    open_markdown_path(app.handle(), path.clone());
                }
            }
            #[cfg(feature = "devtools")]
            if std::env::var("MARKVIEW_DEVTOOLS").is_ok() {
                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                handle_macos_opened_urls(_app, urls);
            }
        });
}
