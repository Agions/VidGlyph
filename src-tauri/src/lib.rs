//! SubLens - Rust Tauri Application Library
//!
//! # Overview
//!
//! SubLens is a desktop application for extracting hardcoded subtitles from videos using OCR and Vision AI.

use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod commands;

pub use commands::file::{
    get_file_info, open_file_dialog, read_text_file, save_file_dialog, write_text_file,
};
pub use commands::scene::detect_scenes;
pub use commands::system::{check_system_dependencies, get_tesseract_languages};
pub use commands::types::{ExportFormat, OCRLang, SubtitleItem};
pub use commands::video::{extract_frame_at_time, get_video_metadata};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    info!("Starting SubLens v{}", env!("CARGO_PKG_VERSION"));

    // Warm up the ONNX OCR engine on startup (non-blocking background task)
    info!("Warming up OCR engine...");
    tauri::async_runtime::spawn(async {
        match commands::ocr_engine::OcrEngine::warmup() {
            Ok(_) => info!("OCR engine warmup complete"),
            Err(e) => tracing::warn!("OCR engine warmup skipped: {}", e),
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::video::get_video_metadata,
            commands::video::extract_frame_at_time,
            commands::ocr_export::export_subtitles,
            commands::file::save_file_dialog,
            commands::file::open_file_dialog,
            commands::file::write_text_file,
            commands::file::read_text_file,
            commands::file::get_file_info,
            commands::scene::detect_scenes,
            commands::ocr_export::ocr_recognize,
            commands::ocr_export::ocr_get_languages,
            commands::auto_roi::auto_detect_roi,
            commands::system::check_system_dependencies,
            commands::system::get_tesseract_languages,
            commands::gpu::check_gpu_capability,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            tracing::error!("Failed to run Tauri application: {}", e);
            eprintln!("ERROR: Failed to start SubLens application: {}", e);
            std::process::exit(1);
        });
}
