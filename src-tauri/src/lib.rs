// Library entry point. Keeping the bulk of the app here (rather than in
// main.rs) lets us share code with future mobile targets and unit-test the
// Tauri setup if we want to.

mod commands;
mod error;

use tauri::Manager;

pub type Result<T> = std::result::Result<T, error::AppError>;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            // --- file ops ---
            commands::file::open_file_dialog,
            commands::file::open_file_path,
            commands::file::save_file,
            commands::file::save_file_dialog,
            commands::file::pick_folder,
            commands::file::hash_file,
            // --- recent ---
            commands::recent::recent_get,
            commands::recent::recent_add,
            commands::recent::recent_remove,
            commands::recent::recent_clear,
            // --- pdf (stubs in M1; native impl in M2+) ---
            commands::pdf::pdf_page_count,
            commands::pdf::pdf_render_page,
            commands::pdf::pdf_extract_text,
            // --- app ---
            commands::app::app_version,
        ])
        .setup(|app| {
            // On startup, log where we are. Useful for debugging first-run.
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(debug_assertions)]
                {
                    window.open_devtools();
                }
                let _ = window.set_title("Open Satchel");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
