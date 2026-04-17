// Tauri command modules. Each submodule exposes #[tauri::command]-annotated
// functions that get registered in lib.rs via tauri::generate_handler![].

pub mod app;
pub mod file;
pub mod font;
pub mod pdf;
pub mod recent;
