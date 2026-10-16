//! VidGlyph · 字映 - Rust Tauri Application Library
//!
//! # Overview
//!
//! VidGlyph is a desktop application for extracting hardcoded subtitles from videos using OCR and Vision AI.

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

    info!("Starting VidGlyph v{}", env!("CARGO_PKG_VERSION"));

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
            commands::pipeline::check_native_ocr_ready,
            commands::pipeline::start_native_pipeline,
            commands::pipeline::cancel_native_pipeline,
            commands::keyring::save_secure_credential,
            commands::keyring::get_secure_credential,
            commands::keyring::delete_secure_credential,
            commands::storage::db_save_project,
            commands::storage::db_load_project,
            commands::storage::db_list_projects,
            commands::storage::db_delete_project,
            commands::storage::db_save_batch_task,
            commands::storage::db_list_batch_tasks,
            commands::storage::export_project_bundle,
            commands::storage::import_project_bundle,
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            tracing::error!("Failed to run Tauri application: {}", e);
            eprintln!("ERROR: Failed to start VidGlyph application: {}", e);
            std::process::exit(1);
        });
}
