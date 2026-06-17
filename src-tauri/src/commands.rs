use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
pub struct FileResult {
    path: String,
    content: String,
}

#[derive(Serialize)]
pub struct SaveResult {
    path: String,
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn file_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).is_file())
}

#[tauri::command]
pub async fn path_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

/// Extensions a Markdown *reader* must never launch from an in-document link.
/// A malicious `.md` could otherwise point a link at a local executable or
/// script and run it on click. We refuse these; the user can still launch them
/// from their own file manager if they trust the file.
fn is_unsafe_to_launch(path: &Path) -> bool {
    const BLOCKED: &[&str] = &[
        "exe", "msi", "msix", "bat", "cmd", "com", "ps1", "psm1", "vbs", "vbe",
        "js", "jse", "wsf", "wsh", "scr", "hta", "cpl", "jar", "reg", "lnk",
        "inf", "scf", "pif", "gadget", "sh", "command", "app", "pkg", "dmg",
        "run", "bin", "deb", "rpm", "appimage", "desktop",
    ];
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| BLOCKED.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[tauri::command]
pub async fn open_local_path(path: String) -> Result<(), String> {
    let path = PathBuf::from(path.trim());
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.display()));
    }
    if is_unsafe_to_launch(&path) {
        return Err(format!(
            "Refused to launch an executable from a document link: {}. \
             Open it from your file manager if you trust it.",
            path.display()
        ));
    }
    open_local_path_impl(&path)
}

#[cfg(target_os = "windows")]
fn open_local_path_impl(path: &Path) -> Result<(), String> {
    std::process::Command::new("cmd")
        .arg("/C")
        .arg("start")
        .arg("")
        .arg(path.as_os_str())
        .spawn()
        .map_err(|e| format!("Windows start failed: {e}"))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_local_path_impl(path: &Path) -> Result<(), String> {
    tauri_plugin_opener::open_path(path, None::<&str>)
        .map_err(|e| format!("open path failed: {e}"))
}

#[tauri::command]
pub async fn find_path_by_name(roots: Vec<String>, name: String) -> Result<Option<String>, String> {
    if name.contains('/') || name.contains('\\') {
        return Ok(None);
    }

    let target = name.trim();
    if target.is_empty() || target == "." || target == ".." {
        return Ok(None);
    }

    let mut visited = 0usize;
    for root in roots.into_iter().take(4) {
        let root = PathBuf::from(root);
        if !root.is_dir() {
            continue;
        }
        if let Some(found) = find_path_by_name_in_dir(&root, target, 0, &mut visited) {
            return Ok(Some(found.to_string_lossy().to_string()));
        }
        if visited > 5_000 {
            break;
        }
    }

    Ok(None)
}

fn find_path_by_name_in_dir(
    dir: &Path,
    target: &str,
    depth: usize,
    visited: &mut usize,
) -> Option<PathBuf> {
    if depth > 6 || *visited > 5_000 {
        return None;
    }

    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .collect();
    entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

    for path in &entries {
        *visited += 1;
        if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(target))
        {
            return Some(path.clone());
        }
    }

    for path in entries {
        if path.is_dir() {
            if let Some(found) = find_path_by_name_in_dir(&path, target, depth + 1, visited) {
                return Some(found);
            }
        }
    }

    None
}

#[tauri::command]
pub async fn save_markdown_dialog(
    app: AppHandle,
    suggested_name: String,
    content: String,
) -> Result<Option<SaveResult>, String> {
    let file_name = ensure_markdown_file_name(&suggested_name);
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog()
        .file()
        .add_filter("Markdown", &["md", "mdx", "markdown"])
        .set_file_name(&file_name)
        .save_file(move |file_path| {
            let _ = tx.send(file_path);
        });

    if let Ok(Some(file_path)) = rx.recv() {
        let mut path = file_path
            .into_path()
            .map_err(|e| format!("save path: {e}"))?;
        if path.extension().is_none() {
            path.set_extension("md");
        }
        fs::write(&path, content).map_err(|e| format!("write saved markdown: {e}"))?;
        Ok(Some(SaveResult {
            path: path.to_string_lossy().to_string(),
        }))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn open_file_dialog(app: AppHandle) -> Result<Option<FileResult>, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().add_filter("Markdown", &["md", "mdx", "markdown"]).pick_file(move |file_path| {
        let _ = tx.send(file_path);
    });

    if let Ok(Some(file_path)) = rx.recv() {
        let path = file_path
            .into_path()
            .map_err(|e| format!("resolve picked path: {e}"))?;
        let path_str = path.to_string_lossy().to_string();
        let content = fs::read_to_string(&path_str)
            .map_err(|e| format!("read {path_str}: {e}"))?;
        Ok(Some(FileResult {
            path: path_str,
            content,
        }))
    } else {
        Ok(None)
    }
}

fn ensure_markdown_file_name(name: &str) -> String {
    let trimmed = name.trim();
    let base = if trimmed.is_empty() { "document.md" } else { trimmed };
    let lower = base.to_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".mdx") || lower.ends_with(".markdown") {
        base.to_string()
    } else {
        format!("{base}.md")
    }
}

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::Mutex;
use tauri::State;

pub struct WatcherState {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}

#[tauri::command]
pub async fn watch_file(path: String, app: AppHandle, state: State<'_, WatcherState>) -> Result<(), String> {
    let mut watcher_guard = state.watcher.lock().unwrap();

    // Stop previous watcher if exists
    *watcher_guard = None;

    let app_handle = app.clone();
    let path_clone = path.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        match res {
            Ok(event) => {
                if event.kind.is_modify() || event.kind.is_create() {
                    let _ = app_handle.emit("file-changed", &path_clone);
                }
            }
            Err(_) => {}
        }
    }).map_err(|e| e.to_string())?;

    watcher.watch(Path::new(&path), RecursiveMode::NonRecursive).map_err(|e| e.to_string())?;
    *watcher_guard = Some(watcher);

    Ok(())
}

#[tauri::command]
pub async fn unwatch_file(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut watcher_guard = state.watcher.lock().unwrap();
    *watcher_guard = None;
    Ok(())
}

pub struct InitialFileState {
    pub path: Mutex<Option<String>>,
}

#[tauri::command]
pub async fn get_initial_file(state: State<'_, InitialFileState>) -> Result<Option<String>, String> {
    let mut guard = state.path.lock().unwrap();
    Ok(guard.take()) // take() returns the value and leaves None — one-shot
}

#[tauri::command]
pub fn open_default_apps_settings(_app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return set_default_windows();
    }
    #[cfg(target_os = "macos")]
    {
        return set_default_macos(&_app.config().identifier);
    }
    #[cfg(target_os = "linux")]
    {
        ensure_linux_desktop_entry()?;
        let mime_types = ["text/markdown", "text/x-markdown"];
        for mime in mime_types {
            let output = std::process::Command::new("xdg-mime")
                .args(["default", "vellum.desktop", mime])
                .output()
                .map_err(|e| format!("xdg-mime spawn failed: {e}"))?;
            if !output.status.success() {
                return Err(format!(
                    "xdg-mime failed for {mime}: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
        }
        return Ok(());
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    Err("Setting default app is not supported on this platform yet".into())
}

/// Register Vellum as the default Markdown viewer on macOS.
///
/// The bundled app already declares the file associations in Info.plist via
/// tauri.conf.json. This command asks LaunchServices to make this bundle the
/// viewer for the UTIs resolved from the Markdown file extensions.
#[cfg(target_os = "macos")]
fn set_default_macos(bundle_id: &str) -> Result<(), String> {
    // `.md` is the association that matters. `.mdx` / `.markdown` are best-effort:
    // a niche extension has no system-registered content type (unless our own
    // UTExportedTypeDeclarations in Info.plist is in effect), and asking
    // LaunchServices to set a handler for an unregistered / dynamic type returns
    // OSStatus -50. Don't fail the whole operation — or show the user a scary
    // red error — when the primary `.md` association succeeded.
    let primary = set_default_macos_extension("md", bundle_id);
    for ext in ["mdx", "markdown"] {
        let _ = set_default_macos_extension(ext, bundle_id);
    }
    primary.map_err(|err| format!("macOS LaunchServices failed to set .md as the default: {err}"))
}

#[cfg(target_os = "macos")]
type CFStringRef = *const std::ffi::c_void;

#[cfg(target_os = "macos")]
type CFTypeRef = *const std::ffi::c_void;

#[cfg(target_os = "macos")]
type OSStatus = i32;

#[cfg(target_os = "macos")]
const K_CFSTRING_ENCODING_UTF8: u32 = 0x0800_0100;

#[cfg(target_os = "macos")]
const K_LS_ROLES_VIEWER: u32 = 0x0000_0002;

#[cfg(target_os = "macos")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringCreateWithCString(
        alloc: *const std::ffi::c_void,
        c_str: *const std::ffi::c_char,
        encoding: u32,
    ) -> CFStringRef;
    fn CFRelease(cf: CFTypeRef);
}

#[cfg(target_os = "macos")]
#[link(name = "CoreServices", kind = "framework")]
extern "C" {
    fn UTTypeCreatePreferredIdentifierForTag(
        in_tag_class: CFStringRef,
        in_tag: CFStringRef,
        in_conforming_to_uti: CFStringRef,
    ) -> CFStringRef;
    fn LSSetDefaultRoleHandlerForContentType(
        in_content_type: CFStringRef,
        in_role: u32,
        in_handler_bundle_id: CFStringRef,
    ) -> OSStatus;
}

#[cfg(target_os = "macos")]
struct OwnedCFString(CFStringRef);

#[cfg(target_os = "macos")]
impl OwnedCFString {
    fn new(value: &str) -> Result<Self, String> {
        let c_value = std::ffi::CString::new(value)
            .map_err(|_| format!("value contains an interior NUL byte: {value}"))?;
        let ptr = unsafe {
            CFStringCreateWithCString(
                std::ptr::null(),
                c_value.as_ptr(),
                K_CFSTRING_ENCODING_UTF8,
            )
        };

        if ptr.is_null() {
            Err(format!("CFStringCreateWithCString failed for {value}"))
        } else {
            Ok(Self(ptr))
        }
    }

    unsafe fn from_create_rule(ptr: CFStringRef, description: &str) -> Result<Self, String> {
        if ptr.is_null() {
            Err(format!("{description} returned null"))
        } else {
            Ok(Self(ptr))
        }
    }
}

#[cfg(target_os = "macos")]
impl Drop for OwnedCFString {
    fn drop(&mut self) {
        unsafe {
            CFRelease(self.0 as CFTypeRef);
        }
    }
}

#[cfg(target_os = "macos")]
fn set_default_macos_extension(extension: &str, bundle_id: &str) -> Result<(), String> {
    let tag_class = OwnedCFString::new("public.filename-extension")?;
    let tag = OwnedCFString::new(extension)?;
    let bundle_id = OwnedCFString::new(bundle_id)?;
    let uti = unsafe {
        OwnedCFString::from_create_rule(
            UTTypeCreatePreferredIdentifierForTag(tag_class.0, tag.0, std::ptr::null()),
            "UTTypeCreatePreferredIdentifierForTag",
        )?
    };

    let status = unsafe {
        LSSetDefaultRoleHandlerForContentType(uti.0, K_LS_ROLES_VIEWER, bundle_id.0)
    };

    if status == 0 {
        Ok(())
    } else {
        Err(format!(
            "LSSetDefaultRoleHandlerForContentType returned OSStatus {status}"
        ))
    }
}

/// Register Vellum as the default handler for .md/.mdx/.markdown on Windows.
///
/// Writes to HKCU (no admin required):
/// 1. ProgID with shell\open\command pointing to current exe
/// 2. OpenWithProgids entries so Vellum appears in "Open With"
/// 3. RegisteredApplications + Capabilities for Windows Settings integration
/// 4. Notifies the shell so Explorer picks up the change immediately
#[cfg(target_os = "windows")]
fn set_default_windows() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let exe = std::env::current_exe()
        .map_err(|e| format!("current_exe: {e}"))?;
    let exe_str = exe.to_string_lossy().to_string();
    let open_cmd = format!("\"{}\" \"%1\"", exe_str);
    let prog_id = "Vellum.Markdown";
    let extensions = [".md", ".mdx", ".markdown"];

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    // 1. Create ProgID: HKCU\Software\Classes\Vellum.Markdown
    let (prog_key, _) = hkcu
        .create_subkey(format!("Software\\Classes\\{}", prog_id))
        .map_err(|e| format!("create ProgID: {e}"))?;
    prog_key.set_value("", &"Markdown Document").map_err(|e| format!("set ProgID default: {e}"))?;

    // FriendlyTypeName
    prog_key
        .set_value("FriendlyTypeName", &"Markdown Document")
        .map_err(|e| format!("set FriendlyTypeName: {e}"))?;

    // DefaultIcon
    let (icon_key, _) = prog_key
        .create_subkey("DefaultIcon")
        .map_err(|e| format!("create DefaultIcon: {e}"))?;
    icon_key
        .set_value("", &format!("{},0", exe_str))
        .map_err(|e| format!("set icon: {e}"))?;

    // shell\open\command
    let (cmd_key, _) = prog_key
        .create_subkey("shell\\open\\command")
        .map_err(|e| format!("create command key: {e}"))?;
    cmd_key
        .set_value("", &open_cmd)
        .map_err(|e| format!("set command: {e}"))?;

    // 2. Register for each extension
    for ext in extensions {
        // Set OpenWithProgids so Vellum appears in "Open with" menu
        let (owp_key, _) = hkcu
            .create_subkey(format!("Software\\Classes\\{}\\OpenWithProgids", ext))
            .map_err(|e| format!("create OpenWithProgids for {ext}: {e}"))?;
        // Empty binary value to register
        owp_key
            .set_raw_value(prog_id, &winreg::RegValue {
                vtype: REG_NONE,
                bytes: vec![],
            })
            .map_err(|e| format!("set OpenWithProgids for {ext}: {e}"))?;

        // Set the extension default to our ProgID
        let (ext_key, _) = hkcu
            .create_subkey(format!("Software\\Classes\\{}", ext))
            .map_err(|e| format!("create ext key for {ext}: {e}"))?;
        ext_key
            .set_value("", &prog_id)
            .map_err(|e| format!("set ext default for {ext}: {e}"))?;

        // Clear UserChoice so Windows re-evaluates (best effort — may be protected)
        let uc_path = format!(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\{}\\UserChoice",
            ext
        );
        let _ = hkcu.delete_subkey_all(&uc_path); // ignore errors — often protected
    }

    // 3. Register as a "Registered Application" for Windows Settings integration
    let (cap_key, _) = hkcu
        .create_subkey("Software\\Vellum\\Capabilities")
        .map_err(|e| format!("create Capabilities: {e}"))?;
    cap_key
        .set_value("ApplicationName", &"Vellum - Markdown Reader")
        .map_err(|e| format!("set ApplicationName: {e}"))?;
    cap_key
        .set_value("ApplicationDescription", &"A clean, fast Markdown reader for Windows")
        .map_err(|e| format!("set ApplicationDescription: {e}"))?;

    let (fa_key, _) = cap_key
        .create_subkey("FileAssociations")
        .map_err(|e| format!("create FileAssociations: {e}"))?;
    for ext in extensions {
        fa_key
            .set_value(ext, &prog_id)
            .map_err(|e| format!("set FileAssociation for {ext}: {e}"))?;
    }

    let (reg_apps, _) = hkcu
        .create_subkey("Software\\RegisteredApplications")
        .map_err(|e| format!("create RegisteredApplications: {e}"))?;
    reg_apps
        .set_value("Vellum", &"Software\\Vellum\\Capabilities")
        .map_err(|e| format!("set RegisteredApplications: {e}"))?;

    // 4. Notify the shell that associations have changed
    notify_shell_assoc_changed();

    Ok(())
}

/// Call SHChangeNotify(SHCNE_ASSOCCHANGED) to tell Explorer to refresh file associations.
#[cfg(target_os = "windows")]
fn notify_shell_assoc_changed() {
    // Load shell32.dll and call SHChangeNotify dynamically to avoid linking issues.
    // SHCNE_ASSOCCHANGED = 0x08000000, SHCNF_IDLIST = 0x0000
    use std::ffi::CString;
    let lib_name = CString::new("shell32.dll").unwrap();
    let fn_name = CString::new("SHChangeNotify").unwrap();
    unsafe {
        let lib = winapi_load_library(lib_name.as_ptr());
        if !lib.is_null() {
            let func = winapi_get_proc(lib, fn_name.as_ptr());
            if !func.is_null() {
                let sh_change_notify: unsafe extern "system" fn(i32, u32, *const (), *const ()) =
                    std::mem::transmute(func);
                sh_change_notify(0x08000000, 0x0000, std::ptr::null(), std::ptr::null());
            }
        }
    }
}

#[cfg(target_os = "windows")]
unsafe fn winapi_load_library(name: *const i8) -> *mut std::ffi::c_void {
    extern "system" {
        fn LoadLibraryA(lpLibFileName: *const i8) -> *mut std::ffi::c_void;
    }
    unsafe { LoadLibraryA(name) }
}

#[cfg(target_os = "windows")]
unsafe fn winapi_get_proc(module: *mut std::ffi::c_void, name: *const i8) -> *mut std::ffi::c_void {
    extern "system" {
        fn GetProcAddress(hModule: *mut std::ffi::c_void, lpProcName: *const i8) -> *mut std::ffi::c_void;
    }
    unsafe { GetProcAddress(module, name) }
}

/// On Linux, ensure a user-local vellum.desktop exists at
/// ~/.local/share/applications/vellum.desktop so that xdg-mime can reference
/// it. Packaged installs (deb/appimage/snap) already ship one system-wide —
/// this is a safety net mainly for dev builds.
#[cfg(target_os = "linux")]
fn ensure_linux_desktop_entry() -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let apps_dir = std::path::PathBuf::from(&home).join(".local/share/applications");
    fs::create_dir_all(&apps_dir).map_err(|e| format!("create apps dir: {e}"))?;
    let desktop_path = apps_dir.join("vellum.desktop");

    // Prefer system-installed entry if present — don't overwrite it.
    if Path::new("/usr/share/applications/vellum.desktop").exists() {
        return Ok(());
    }

    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let exe_str = exe.to_string_lossy();
    // Desktop Entry spec: quote exe path if it contains spaces or special chars,
    // and escape inner double-quotes + backslashes.
    let exe_escaped = exe_str.replace('\\', r"\\").replace('"', r#"\""#);
    let exec_field = if exe_str.contains(|c: char| c.is_whitespace() || "\"`$".contains(c)) {
        format!("\"{exe_escaped}\" %f")
    } else {
        format!("{exe_str} %f")
    };
    let content = format!(
        "[Desktop Entry]\nType=Application\nName=Vellum\nGenericName=Markdown Reader\n\
         Comment=Read Markdown files with Mermaid, KaTeX, and Vega-Lite support\n\
         Exec={exec_field}\nIcon=vellum\nTerminal=false\n\
         Categories=Office;TextEditor;Viewer;\n\
         MimeType=text/markdown;text/x-markdown;\n\
         StartupWMClass=vellum\n"
    );
    fs::write(&desktop_path, content).map_err(|e| format!("write desktop: {e}"))?;

    // Refresh desktop database so xdg-mime picks up the new entry.
    let _ = std::process::Command::new("update-desktop-database")
        .arg(&apps_dir)
        .output();
    Ok(())
}
