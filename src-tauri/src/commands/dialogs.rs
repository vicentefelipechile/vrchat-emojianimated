// src-tauri/src/commands/dialogs.rs
// Native file open/save dialogs via tauri-plugin-dialog.

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

#[tauri::command]
pub async fn open_file_dialog(app: AppHandle) -> Result<Option<String>, String> {
    let file = app
        .dialog()
        .file()
        .add_filter(
            "Video / GIF",
            &["gif", "mp4", "webm", "mov", "avi", "mkv"],
        )
        .blocking_pick_file();

    Ok(file.and_then(|fp| match fp {
        FilePath::Path(p) => p.to_str().map(|s| s.to_string()),
        FilePath::Url(u)  => Some(u.to_string()),
    }))
}

#[tauri::command]
pub async fn save_file_dialog(
    app: AppHandle,
    default_path: String,
) -> Result<Option<String>, String> {
    let filename = std::path::Path::new(&default_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("output.png")
        .to_string();

    let file = app
        .dialog()
        .file()
        .add_filter("PNG Image", &["png"])
        .set_file_name(&filename)
        .blocking_save_file();

    Ok(file.and_then(|fp| match fp {
        FilePath::Path(p) => p.to_str().map(|s| s.to_string()),
        FilePath::Url(u)  => Some(u.to_string()),
    }))
}
