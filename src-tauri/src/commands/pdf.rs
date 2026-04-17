// PDF commands.
//
// M1 status: stubs that return errors, signalling the frontend to fall back
// to its pdfjs-based rendering. This establishes the contract that M2+ fills
// in with real implementations (likely backed by pdfium-render for rendering
// and lopdf for structural edits, with MuPDF added in M4 for exotic cases).
//
// The frontend checks for AppError::Pdf variants and degrades gracefully.

use crate::error::AppError;
use crate::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct RenderedPage {
    pub width: u32,
    pub height: u32,
    pub png_bytes: Vec<u8>,
}

/// Count pages in a PDF.
///
/// M1 stub. Real impl in M2 via pdfium-render or lopdf's trailer traversal.
#[tauri::command]
pub fn pdf_page_count(_bytes: Vec<u8>) -> Result<u32> {
    Err(AppError::Pdf(
        "native pdf engine not yet wired (M2); using frontend fallback".into(),
    ))
}

/// Render one page to PNG at the given scale.
///
/// M1 stub. Real impl in M2 via pdfium-render::pdf_to_image.
#[tauri::command]
pub fn pdf_render_page(
    _bytes: Vec<u8>,
    _page_index: u32,
    _scale: f32,
) -> Result<RenderedPage> {
    Err(AppError::Pdf(
        "native pdf engine not yet wired (M2); using frontend fallback".into(),
    ))
}

/// Extract text from a page, preserving approximate word boxes.
///
/// M1 stub. Real impl in M3 (it's a prerequisite for content-stream editing).
#[tauri::command]
pub fn pdf_extract_text(_bytes: Vec<u8>, _page_index: u32) -> Result<String> {
    Err(AppError::Pdf(
        "native pdf engine not yet wired (M3); using frontend fallback".into(),
    ))
}
