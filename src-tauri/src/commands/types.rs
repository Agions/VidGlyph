//! Shared types for the VidGlyph commands layer.
//!
//! All cross-cutting data structures live here to avoid duplication.

use serde::{Deserialize, Serialize};

/// Region of interest within a video frame for subtitle extraction.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(clippy::upper_case_acronyms)]
pub struct ROI {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub roi_type: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub enabled: bool,
    #[serde(default = "default_unit")]
    pub unit: String,
}

fn default_unit() -> String {
    "percent".to_string()
}

impl Default for ROI {
    fn default() -> Self {
        Self {
            id: "default".to_string(),
            name: "Default".to_string(),
            roi_type: "bottom".to_string(),
            x: 0,
            y: 80,
            width: 100,
            height: 20,
            enabled: true,
            unit: "percent".to_string(),
        }
    }
}

/// A single subtitle entry with timing and text.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleItem {
    /// 1-based sequential index used in SRT/VTT/CSV export.
    #[serde(default)]
    pub index: usize,
    /// Unique identifier used in JSON export.
    #[serde(default)]
    pub id: String,
    pub start_time: f64,
    pub end_time: f64,
    pub text: String,
    #[serde(default)]
    pub confidence: f64,
    /// Detected language code (e.g. "en", "zh").
    #[serde(default)]
    pub language: String,
    /// Frame index at which this subtitle starts (optional, 0 if unknown).
    #[serde(default)]
    pub start_frame: u32,
    /// Frame index at which this subtitle ends (optional, 0 if unknown).
    #[serde(default)]
    pub end_frame: u32,
}

/// Supported subtitle export formats.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    SRT,
    WebVTT,
    ASS,
    SSA,
    JSON,
    TXT,
    LRC,
    SBV,
    CSV,
}

impl std::fmt::Display for ExportFormat {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ExportFormat::SRT => write!(f, "srt"),
            ExportFormat::WebVTT => write!(f, "vtt"),
            ExportFormat::ASS => write!(f, "ass"),
            ExportFormat::SSA => write!(f, "ssa"),
            ExportFormat::JSON => write!(f, "json"),
            ExportFormat::TXT => write!(f, "txt"),
            ExportFormat::LRC => write!(f, "lrc"),
            ExportFormat::SBV => write!(f, "sbv"),
            ExportFormat::CSV => write!(f, "csv"),
        }
    }
}

// ── OCR types ───────────────────────────────────────────────────────────────

/// A single OCR detection result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OCRResult {
    pub text: String,
    pub confidence: f32,
    pub bbox: BBox,
}

/// Bounding box for a detected text region.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Supported OCR language entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OCRLang {
    pub code: String,
    pub name: String,
}
