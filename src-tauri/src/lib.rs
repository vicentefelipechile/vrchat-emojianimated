mod commands;

use commands::{
    analyze::analyze_media,
    assemble::assemble_sheet,
    dialogs::{open_file_dialog, save_file_dialog},
    extract::{cleanup_temp, extract_frames, extract_preview},
    download::{check_dependencies, download_dependencies},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            analyze_media,
            extract_frames,
            extract_preview,
            assemble_sheet,
            cleanup_temp,
            open_file_dialog,
            save_file_dialog,
            check_dependencies,
            download_dependencies,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
